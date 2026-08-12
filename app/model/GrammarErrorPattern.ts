import { Bone } from 'leoric';
import type { GrammarErrorType } from '../module/ai/service/ProductAIService';

export default class GrammarErrorPattern extends Bone {
  static table = 'grammar_error_patterns';

  declare id: string;
  declare userId: string;
  declare errorType: GrammarErrorType;
  declare occurrenceCount: number;
  declare correctedAt?: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}
