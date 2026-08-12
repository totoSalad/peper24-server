import { z } from 'zod';
import { grammarErrorTypes } from '../service/ProductAIService';

export const GrammarAnalysisSchema = z.object({
  explicitGrammarQuestion: z.boolean(),
  errors: z.array(z.object({
    errorType: z.enum(grammarErrorTypes),
    original: z.string().min(1).max(300),
    corrected: z.string().min(1).max(300),
    note: z.string().min(1).max(200),
  })).max(8),
});
