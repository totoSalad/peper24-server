export const VOICE_CONTENT_TYPES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/mp4',
] as const;

export type VoiceContentType = typeof VOICE_CONTENT_TYPES[number];
export type VoiceRecordingStatus =
  | 'uploading'
  | 'submitting'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired';

export interface VoiceRecordingRecord {
  id: string;
  userId: string;
  messageId?: string;
  objectKey: string;
  contentType: VoiceContentType;
  sizeBytes: number;
  durationMs?: number;
  status: VoiceRecordingStatus;
  providerTaskId?: string;
  transcript?: string;
  errorCode?: string;
  expiresAt: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SignedUpload {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectMetadata {
  sizeBytes: number;
  contentType: string;
}

export interface UploadRequest {
  key: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds: number;
}

export type SpeechTransaction = unknown;

export abstract class ObjectStorage {
  abstract createUploadUrl(input: UploadRequest): Promise<SignedUpload>;
  abstract headObject(key: string): Promise<ObjectMetadata>;
  abstract createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  abstract deleteObject(key: string): Promise<void>;
}

export abstract class SpeechRecognitionProvider {
  abstract submit(input: { audioUrl: string }): Promise<{ taskId: string }>;
  abstract poll(taskId: string): Promise<
  | { status: 'processing' }
  | { status: 'completed'; transcript: string; durationMs?: number }
  | { status: 'failed'; code: string }
  >;
}

export abstract class SpeechRepository {
  abstract createRecording(record: VoiceRecordingRecord): Promise<void>;
  abstract findRecording(userId: string, recordingId: string): Promise<VoiceRecordingRecord | null>;
  abstract findRecordingByMessage(
    userId: string,
    messageId: string,
  ): Promise<VoiceRecordingRecord | null>;
  abstract findRecordingsByMessages(
    userId: string,
    messageIds: string[],
  ): Promise<VoiceRecordingRecord[]>;
  abstract claimTranscription(
    userId: string,
    recordingId: string,
    durationMs: number,
    updatedAt: Date,
    staleBefore: Date,
  ): Promise<{ claimed: boolean; recording: VoiceRecordingRecord }>;
  abstract markTranscriptionSubmitted(
    userId: string,
    recordingId: string,
    taskId: string,
    durationMs: number,
    updatedAt: Date,
  ): Promise<VoiceRecordingRecord>;
  abstract completeTranscription(
    userId: string,
    recordingId: string,
    transcript: string,
    durationMs: number | undefined,
    updatedAt: Date,
  ): Promise<VoiceRecordingRecord>;
  abstract failTranscription(
    userId: string,
    recordingId: string,
    errorCode: string,
    updatedAt: Date,
  ): Promise<VoiceRecordingRecord>;
  abstract failStaleSubmission(
    userId: string,
    recordingId: string,
    staleBefore: Date,
    errorCode: string,
    updatedAt: Date,
  ): Promise<VoiceRecordingRecord>;
  abstract findRecordingForUpdate(
    transaction: SpeechTransaction,
    userId: string,
    recordingId: string,
  ): Promise<VoiceRecordingRecord | null>;
  abstract bindRecordingToMessage(
    transaction: SpeechTransaction,
    recordingId: string,
    messageId: string,
    updatedAt: Date,
  ): Promise<boolean>;
  abstract findExpiredRecordings(now: Date, limit: number): Promise<VoiceRecordingRecord[]>;
  abstract markRecordingExpired(recordingId: string, updatedAt: Date): Promise<void>;
}
