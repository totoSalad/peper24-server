import { z } from 'zod';

const conciseItems = z.array(z.string().trim().min(1)
  .max(200))
  .max(3);

export const DailyLearningSummarySchema = z.object({
  headline: z.string().trim().min(1)
    .max(100),
  highlights: conciseItems,
  improvements: conciseItems,
  nextSteps: conciseItems,
});
