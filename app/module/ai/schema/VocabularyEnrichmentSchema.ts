import { z } from 'zod';

const vocabularyDetail = z.object({
  cnMeaning: z.string().trim().min(1)
    .max(500),
  enMeaning: z.string().trim().min(1)
    .max(500),
  example: z.string().trim().min(1)
    .max(1000),
  phonetic: z.string().trim().min(1)
    .max(200),
}).strict();

export const VocabularyEnrichmentSchema = z.union([
  vocabularyDetail,
  z.object({}).strict(),
]);
