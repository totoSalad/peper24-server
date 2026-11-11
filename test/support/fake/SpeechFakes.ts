import type {
  ObjectMetadata,
  ObjectStorage,
  SignedUpload,
  SpeechRecognitionProvider,
  SpeechRepository,
  UploadRequest,
  VoiceRecordingRecord,
} from '../../../app/module/speech/service/SpeechPorts';
import type { Clock, IdGenerator } from '../../../app/module/system/service/SystemPorts';

export class SpeechFixedIdGenerator implements IdGenerator {
  private index = 0;
  constructor(private readonly ids: string[]) {}
  next(): string {
    const value = this.ids[this.index++];
    if (!value) throw new Error('No fixed speech ID available');
    return value;
  }
}

export class SpeechFakeClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return new Date(this.current); }
  set(value: Date): void { this.current = value; }
}

export class FakeObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, ObjectMetadata>();
  readonly uploads: UploadRequest[] = [];
  readonly deleteCalls: string[] = [];
  readonly deleteFailures = new Set<string>();

  async createUploadUrl(input: UploadRequest): Promise<SignedUpload> {
    this.uploads.push(input);
    return {
      url: `https://upload.test/${input.key}`,
      headers: { 'Content-Type': input.contentType },
      expiresAt: new Date('2026-08-06T01:05:00.000Z'),
    };
  }
  async headObject(key: string): Promise<ObjectMetadata> {
    const value = this.objects.get(key);
    if (!value) throw new Error('object not found');
    return value;
  }
  async createDownloadUrl(key: string): Promise<string> {
    return `https://download.test/${key}`;
  }
  async deleteObject(key: string): Promise<void> {
    this.deleteCalls.push(key);
    if (this.deleteFailures.has(key)) throw new Error('temporary delete failure');
    this.objects.delete(key);
  }
}

export class FakeSpeechRecognitionProvider implements SpeechRecognitionProvider {
  submitCalls = 0;
  pollCalls = 0;
  readonly submissions: Array<{ audioUrl: string }> = [];
  submitFailure?: Error;
  result: Awaited<ReturnType<SpeechRecognitionProvider['poll']>> = {
    status: 'completed', transcript: 'Hello there.', durationMs: 900,
  };
  readonly results: Array<Awaited<ReturnType<SpeechRecognitionProvider['poll']>>> = [];
  async submit(input: { audioUrl: string }): Promise<{ taskId: string }> {
    this.submitCalls += 1;
    this.submissions.push(input);
    if (this.submitFailure) throw this.submitFailure;
    return { taskId: `task-${this.submitCalls}` };
  }
  async poll() {
    this.pollCalls += 1;
    return this.results.shift() ?? this.result;
  }
}

export class InMemorySpeechRepository implements SpeechRepository {
  readonly recordings = new Map<string, VoiceRecordingRecord>();

  async createRecording(record: VoiceRecordingRecord): Promise<void> {
    this.recordings.set(record.id, { ...record });
  }
  async findRecording(userId: string, recordingId: string): Promise<VoiceRecordingRecord | null> {
    const value = this.recordings.get(recordingId);
    return value?.userId === userId ? { ...value } : null;
  }
  async findRecordingByMessage(userId: string, messageId: string): Promise<VoiceRecordingRecord | null> {
    const value = [ ...this.recordings.values() ]
      .find(item => item.userId === userId && item.messageId === messageId);
    return value ? { ...value } : null;
  }
  async findRecordingsByMessages(userId: string, messageIds: string[]): Promise<VoiceRecordingRecord[]> {
    return [ ...this.recordings.values() ]
      .filter(item => item.userId === userId && item.messageId && messageIds.includes(item.messageId))
      .map(item => ({ ...item }));
  }
  async claimTranscription(
    userId: string, recordingId: string, durationMs: number,
    updatedAt: Date, staleBefore: Date,
  ) {
    const value = this.requireRecording(userId, recordingId);
    if (value.status !== 'uploading' && value.status !== 'failed'
      && !(value.status === 'submitting' && value.updatedAt <= staleBefore)) {
      return { claimed: false, recording: { ...value } };
    }
    Object.assign(value, {
      status: 'submitting', durationMs, errorCode: undefined, providerTaskId: undefined, updatedAt,
    });
    return { claimed: true, recording: { ...value } };
  }
  async markTranscriptionSubmitted(
    userId: string, recordingId: string, taskId: string, durationMs: number, updatedAt: Date,
  ) {
    const value = this.requireRecording(userId, recordingId);
    if (!value.providerTaskId && value.status === 'submitting') {
      Object.assign(value, { providerTaskId: taskId, durationMs, status: 'processing', updatedAt });
    }
    return { ...value };
  }
  async completeTranscription(
    userId: string, recordingId: string, transcript: string,
    durationMs: number | undefined, updatedAt: Date,
  ) {
    const value = this.requireRecording(userId, recordingId);
    Object.assign(value, {
      transcript, durationMs: durationMs ?? value.durationMs, status: 'completed', updatedAt,
    });
    return { ...value };
  }
  async failTranscription(
    userId: string, recordingId: string, errorCode: string, updatedAt: Date,
  ) {
    const value = this.requireRecording(userId, recordingId);
    Object.assign(value, { errorCode, status: 'failed', updatedAt });
    return { ...value };
  }
  async failStaleSubmission(
    userId: string, recordingId: string, staleBefore: Date,
    errorCode: string, updatedAt: Date,
  ) {
    const value = this.requireRecording(userId, recordingId);
    if (value.status === 'submitting' && value.updatedAt <= staleBefore) {
      Object.assign(value, { errorCode, status: 'failed', updatedAt });
    }
    return { ...value };
  }
  async findRecordingForUpdate(
    _transaction: unknown, userId: string, recordingId: string,
  ): Promise<VoiceRecordingRecord | null> {
    return this.findRecording(userId, recordingId);
  }
  async bindRecordingToMessage(
    _transaction: unknown, recordingId: string, messageId: string, updatedAt: Date,
  ): Promise<boolean> {
    const value = this.recordings.get(recordingId);
    if (!value) return false;
    if (value.messageId && value.messageId !== messageId) return false;
    Object.assign(value, { messageId, updatedAt });
    return true;
  }
  async findExpiredRecordings(now: Date, limit: number): Promise<VoiceRecordingRecord[]> {
    return [ ...this.recordings.values() ]
      .filter(item => !item.deletedAt && item.expiresAt <= now)
      .slice(0, limit)
      .map(item => ({ ...item }));
  }
  async markRecordingExpired(recordingId: string, updatedAt: Date): Promise<void> {
    const value = this.recordings.get(recordingId);
    if (value && !value.deletedAt) {
      Object.assign(value, { status: 'expired', deletedAt: updatedAt, updatedAt });
    }
  }
  private requireRecording(userId: string, recordingId: string) {
    const value = this.recordings.get(recordingId);
    if (!value || value.userId !== userId) throw new Error('recording not found');
    return value;
  }
}
