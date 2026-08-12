import { Bone } from 'leoric';
import type { ConversationStatus } from '../module/conversation/service/ConversationPorts';

export default class Conversation extends Bone {
  declare id: string;
  declare userId: string;
  declare topic: string;
  declare scene?: string;
  declare status: ConversationStatus;
  declare summary?: string;
  declare summaryFoldedUntil?: number;
  declare memoryDirtyAt?: Date;
  declare nextMessageSequence: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}
