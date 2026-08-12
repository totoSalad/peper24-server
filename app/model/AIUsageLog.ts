import { Bone } from 'leoric';

export default class AIUsageLog extends Bone {
  static table = 'ai_usage_logs';

  declare messageId: string;
  declare userId: string;
  declare conversationId: string;
  declare task: string;
  declare provider: string;
  declare model: string;
  declare inputTokens: number;
  declare outputTokens: number;
  declare status: 'success' | 'failed';
  declare createdAt: Date;
}
