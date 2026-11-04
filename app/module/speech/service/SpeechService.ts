import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import { AppError } from '../../system/error/AppError';
import { Clock, IdGenerator } from '../../system/service/SystemPorts';
import {
  ObjectStorage,
  SpeechRecognitionProvider,
  SpeechRepository,
  type VoiceContentType,
  type VoiceRecordingRecord,
  VOICE_CONTENT_TYPES,
} from './SpeechPorts';

const MAX_RECORDING_BYTES = 10 * 1024 * 1024;
const MAX_RECORDING_MS = 60_000;
const RECORDING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const UPLOAD_URL_SECONDS = 5 * 60;
const DOWNLOAD_URL_SECONDS = 10 * 60;
const CLEANUP_BATCH_SIZE = 100;

const extensionByType: Record<VoiceContentType, 'webm' | 'mp4'> = {
  'audio/webm': 'webm',
  'audio/webm;codecs=opus': 'webm',
  'audio/mp4': 'mp4',
};

export interface VoiceRecordingSummary {
  id: string;
  status: 'available' | 'expired';
  durationMs?: number;
  expiresAt: string;
}

@SingletonProto({ name: 'SpeechService', accessLevel: AccessLevel.PUBLIC })
export class SpeechService {
  constructor(
    @Inject('SpeechRepository') private readonly repository: SpeechRepository,
    @Inject('ObjectStorage') private readonly storage: ObjectStorage,
    @Inject('SpeechRecognitionProvider') private readonly recognition: SpeechRecognitionProvider,
    @Inject('IdGenerator') private readonly ids: IdGenerator,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async createVoiceUpload(userId: string, input: {
    contentType: string;
    sizeBytes: number;
    extension: string;
  }) {
    if (!VOICE_CONTENT_TYPES.includes(input.contentType as VoiceContentType)) {
      throw new AppError('UNSUPPORTED_AUDIO_TYPE', '只支持 WebM/Opus 或 MP4 音频');
    }
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1
      || input.sizeBytes > MAX_RECORDING_BYTES) {
      throw new AppError('AUDIO_TOO_LARGE', '录音不得超过 10 MB');
    }
    const contentType = input.contentType as VoiceContentType;
    const expectedExtension = extensionByType[contentType];
    if (input.extension.toLowerCase().replace(/^\./, '') !== expectedExtension) {
      throw new AppError('INVALID_AUDIO_EXTENSION', '音频扩展名与格式不匹配');
    }
    const now = this.clock.now();
    const recordingId = this.ids.next();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const objectKey = `voice-recordings/${userId}/${year}/${month}/${recordingId}.${expectedExtension}`;
    const upload = await this.storage.createUploadUrl({
      key: objectKey,
      contentType,
      contentLength: input.sizeBytes,
      expiresInSeconds: UPLOAD_URL_SECONDS,
    });
    await this.repository.createRecording({
      id: recordingId,
      userId,
      objectKey,
      contentType,
      sizeBytes: input.sizeBytes,
      status: 'uploading',
      expiresAt: new Date(now.getTime() + RECORDING_RETENTION_MS),
      createdAt: now,
      updatedAt: now,
    });
    return {
      recordingId,
      uploadUrl: upload.url,
      headers: upload.headers,
      uploadExpiresAt: upload.expiresAt.toISOString(),
    };
  }

  async startTranscription(userId: string, recordingId: string, durationMs: number) {
    if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_RECORDING_MS) {
      throw new AppError('INVALID_RECORDING_DURATION', '录音时长必须在 60 秒内');
    }
    let recording = await this.requireActiveRecording(userId, recordingId);
    if (recording.status === 'completed') return this.toTranscription(recording);
    if (recording.status === 'processing') return this.refreshTranscription(recording);
    if (recording.status === 'submitting') {
      return { status: 'processing' as const, retryAfterMs: 1000 };
    }
    let metadata;
    try {
      metadata = await this.storage.headObject(recording.objectKey);
    } catch {
      throw new AppError('AUDIO_UPLOAD_MISMATCH', '上传音频不存在或不可读取');
    }
    if (metadata.sizeBytes !== recording.sizeBytes || metadata.sizeBytes > MAX_RECORDING_BYTES
      || metadata.contentType !== recording.contentType) {
      throw new AppError('AUDIO_UPLOAD_MISMATCH', '上传音频与签名信息不一致');
    }
    const claim = await this.repository.claimTranscription(
      userId, recordingId, durationMs, this.clock.now(),
    );
    if (!claim.claimed) return this.currentTranscription(claim.recording);
    const audioUrl = await this.storage.createDownloadUrl(recording.objectKey, DOWNLOAD_URL_SECONDS);
    try {
      const submitted = await this.recognition.submit({ audioUrl });
      recording = await this.repository.markTranscriptionSubmitted(
        userId, recordingId, submitted.taskId, durationMs, this.clock.now(),
      );
    } catch {
      await this.repository.failTranscription(
        userId, recordingId, 'SPEECH_PROVIDER_UNAVAILABLE', this.clock.now(),
      );
      throw new AppError('SPEECH_PROVIDER_FAILED', '语音识别服务请求失败', 502);
    }
    return this.refreshTranscription(recording);
  }

  async getTranscription(userId: string, recordingId: string) {
    const recording = await this.requireActiveRecording(userId, recordingId);
    return this.currentTranscription(recording);
  }

  async prepareVoiceMessage(userId: string, recordingId: string) {
    const recording = await this.requireActiveRecording(userId, recordingId);
    if (recording.status !== 'completed' || !recording.transcript?.trim()) {
      throw new AppError('TRANSCRIPTION_NOT_COMPLETED', '录音尚未完成识别', 409);
    }
    return { recordingId: recording.id, transcript: recording.transcript };
  }

  async attachRecording(userId: string, recordingId: string, messageId: string): Promise<void> {
    await this.prepareVoiceMessage(userId, recordingId);
    if (!await this.repository.attachRecording(userId, recordingId, messageId, this.clock.now())) {
      throw new AppError('VOICE_RECORDING_ALREADY_USED', '该录音已经发送', 409);
    }
  }

  async getMessageVoiceRecording(userId: string, messageId: string) {
    const recording = await this.repository.findRecordingByMessage(userId, messageId);
    if (!recording) throw new AppError('VOICE_RECORDING_NOT_FOUND', '录音不存在', 404);
    this.assertNotExpired(recording);
    const url = await this.storage.createDownloadUrl(recording.objectKey, DOWNLOAD_URL_SECONDS);
    return {
      url,
      expiresAt: new Date(this.clock.now().getTime() + DOWNLOAD_URL_SECONDS * 1000).toISOString(),
      durationMs: recording.durationMs,
      contentType: recording.contentType,
    };
  }

  async describeMessageRecordings(
    userId: string,
    messageIds: string[],
  ): Promise<Record<string, VoiceRecordingSummary>> {
    if (!messageIds.length) return {};
    const recordings = await this.repository.findRecordingsByMessages(userId, messageIds);
    return Object.fromEntries(recordings.flatMap(recording => (recording.messageId ? [[
      recording.messageId,
      {
        id: recording.id,
        status: this.isExpired(recording) ? 'expired' : 'available',
        durationMs: recording.durationMs,
        expiresAt: recording.expiresAt.toISOString(),
      } satisfies VoiceRecordingSummary,
    ]] : [])));
  }

  async expireRecordings(): Promise<{ expired: number; failed: number }> {
    const now = this.clock.now();
    const recordings = await this.repository.findExpiredRecordings(now, CLEANUP_BATCH_SIZE);
    let expired = 0;
    let failed = 0;
    for (const recording of recordings) {
      try {
        await this.storage.deleteObject(recording.objectKey);
        await this.repository.markRecordingExpired(recording.id, now);
        expired += 1;
      } catch {
        failed += 1;
      }
    }
    return { expired, failed };
  }

  private async currentTranscription(recording: VoiceRecordingRecord) {
    if (recording.status === 'completed') return this.toTranscription(recording);
    if (recording.status === 'failed') {
      return { status: 'failed' as const, errorCode: recording.errorCode ?? 'SPEECH_PROVIDER_FAILED' };
    }
    if (recording.status === 'submitting') {
      return { status: 'processing' as const, retryAfterMs: 1000 };
    }
    if (recording.status !== 'processing') {
      throw new AppError('TRANSCRIPTION_NOT_STARTED', '录音尚未开始识别', 409);
    }
    return this.refreshTranscription(recording);
  }

  private async requireActiveRecording(userId: string, recordingId: string) {
    const recording = await this.repository.findRecording(userId, recordingId);
    if (!recording) throw new AppError('VOICE_RECORDING_NOT_FOUND', '录音不存在', 404);
    this.assertNotExpired(recording);
    return recording;
  }

  private assertNotExpired(recording: VoiceRecordingRecord): void {
    if (this.isExpired(recording)) {
      throw new AppError('VOICE_RECORDING_EXPIRED', '录音已经过期', 410);
    }
  }

  private isExpired(recording: VoiceRecordingRecord): boolean {
    return recording.status === 'expired' || Boolean(recording.deletedAt)
      || recording.expiresAt <= this.clock.now();
  }

  private async refreshTranscription(recording: VoiceRecordingRecord) {
    if (!recording.providerTaskId) {
      throw new AppError('TRANSCRIPTION_NOT_STARTED', '录音尚未开始识别', 409);
    }
    let result;
    try {
      result = await this.recognition.poll(recording.providerTaskId);
    } catch {
      throw new AppError('SPEECH_PROVIDER_UNAVAILABLE', '语音识别服务暂时不可用', 503);
    }
    if (result.status === 'processing') {
      return { status: 'processing' as const, retryAfterMs: 1000 };
    }
    if (result.status === 'failed') {
      await this.repository.failTranscription(
        recording.userId, recording.id, 'SPEECH_PROVIDER_FAILED', this.clock.now(),
      );
      return { status: 'failed' as const, errorCode: 'SPEECH_PROVIDER_FAILED' };
    }
    const transcript = result.transcript.trim();
    if (!transcript) {
      await this.repository.failTranscription(
        recording.userId, recording.id, 'EMPTY_TRANSCRIPT', this.clock.now(),
      );
      return { status: 'failed' as const, errorCode: 'EMPTY_TRANSCRIPT' };
    }
    const completed = await this.repository.completeTranscription(
      recording.userId, recording.id, transcript, result.durationMs, this.clock.now(),
    );
    return this.toTranscription(completed);
  }

  private toTranscription(recording: VoiceRecordingRecord) {
    return {
      status: 'completed' as const,
      recordingId: recording.id,
      transcript: recording.transcript ?? '',
      durationMs: recording.durationMs,
    };
  }
}
