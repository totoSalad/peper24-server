import { z } from 'zod';

export const CorrectMemorySchema = z.object({
  content: z.string().trim().min(1)
    .max(500),
  summary: z.string().trim().min(1)
    .max(500)
    .optional(),
}).strict();
