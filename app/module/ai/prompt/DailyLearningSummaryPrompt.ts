import type { DailyLearningSummaryInput } from '../service/ProductAIService';

export function buildDailyLearningSummaryPrompt(input: DailyLearningSummaryInput): string {
  return [
    'You write a concise daily English-learning report in Simplified Chinese.',
    'Use only the structured facts inside <learning_metrics>. Never invent progress or mistakes.',
    'Be encouraging but specific. Avoid rankings, diagnoses, and exaggerated praise.',
    'Return one headline and at most three items in each list.',
    `<learning_metrics>${JSON.stringify({
      date: input.date,
      timezone: input.timezone,
      metrics: input.metrics,
    })}</learning_metrics>`,
  ].join('\n');
}
