import { z } from 'zod';

export const AddVocabularySchema = z.object({
  expression: z.string().trim().min(1)
    .max(200),
  sourceMessageId: z.string().trim().min(1)
    .max(64),
});

export const ReviewAnswerSchema = z.object({
  result: z.enum([ 'again', 'hard', 'good', 'easy' ]),
  clientRequestId: z.string().trim().min(1)
    .max(128),
}).strict();

export const ReviewLimitSchema = z.coerce.number().int().min(1)
  .max(10)
  .default(10);
