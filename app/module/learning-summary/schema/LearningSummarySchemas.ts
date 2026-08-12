import { z } from 'zod';

export const LearningSummaryListSchema = z.object({
  cursor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1)
    .max(50)
    .default(20),
});
