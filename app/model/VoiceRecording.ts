import { Bone } from 'leoric';
import type { VoiceRecordingStatus } from '../module/speech/service/SpeechPorts';

export default class VoiceRecording extends Bone {
  declare id: string;
  declare userId: string;
  declare messageId?: string;
  declare ossKey: string;
  declare contentType: string;
  declare sizeBytes: number;
  declare durationMs?: number;
  declare status: VoiceRecordingStatus;
  declare providerTaskId?: string;
  declare transcript?: string;
  declare errorCode?: string;
  declare expiresAt: Date;
  declare deletedAt?: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}
