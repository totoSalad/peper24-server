import { strict as assert } from 'node:assert';
import { buildDailyLearningSummaryPrompt } from '../../../app/module/ai/prompt/DailyLearningSummaryPrompt';
import { DailyLearningSummarySchema } from '../../../app/module/ai/schema/DailyLearningSummarySchema';

describe('DailyLearningSummary prompt and schema', () => {
  it('serializes metrics as untrusted structured data and forbids invented progress', () => {
    const prompt = buildDailyLearningSummaryPrompt({
      date: '2026-08-11',
      timezone: 'Asia/Shanghai',
      metrics: {
        conversationCount: 1, userMessageCount: 3, chatTokens: 200,
        grammarErrorCount: 0, grammar: [], newVocabularyCount: 0,
        newVocabulary: [], reviewedCount: 0,
        reviewResults: { again: 0, hard: 0, good: 0, easy: 0 },
      },
    });

    assert.match(prompt, /Never invent progress or mistakes/);
    assert.match(prompt, /<learning_metrics>/);
    assert.match(prompt, /"userMessageCount":3/);
  });

  it('limits every generated list to three concise items', () => {
    assert.throws(() => DailyLearningSummarySchema.parse({
      headline: '今日小结',
      highlights: [ '1', '2', '3', '4' ],
      improvements: [],
      nextSteps: [],
    }));
    assert.doesNotThrow(() => DailyLearningSummarySchema.parse({
      headline: '今日小结',
      highlights: [ '完成一次对话' ],
      improvements: [ '继续注意时态' ],
      nextSteps: [ '复习新增表达' ],
    }));
  });
});
