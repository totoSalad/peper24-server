import { z } from 'zod';

export const TranslationOutputSchema = z.object({
  translation: z.string().trim().min(1)
    .max(8000),
});
