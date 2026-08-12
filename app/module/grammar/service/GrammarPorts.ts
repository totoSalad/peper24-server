import type {
  Correction,
  GrammarErrorType,
} from '../../ai/service/ProductAIService';

export interface GrammarOccurrenceGroup {
  errorType: GrammarErrorType;
  details: Correction[];
}
