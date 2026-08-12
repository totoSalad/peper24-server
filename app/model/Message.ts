import { Bone } from 'leoric';
import type {
  MessageRole,
  MessageStatus,
} from '../module/conversation/service/ConversationPorts';

export default class Message extends Bone {
  declare id: string;
  declare conversationId: string;
  declare replyToMessageId?: string;
  declare role: MessageRole;
  declare status: MessageStatus;
  declare content: string;
  declare translation?: string;
  declare correctionJson?: string;
  declare toolEventsJson?: string;
  declare clientRequestId?: string;
  declare memoryScannedAt?: Date;
  declare sequence: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}
