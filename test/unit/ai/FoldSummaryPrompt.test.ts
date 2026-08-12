import { strict as assert } from 'node:assert';
import { buildFoldSummaryPrompt } from '../../../app/module/ai/prompt/FoldSummaryPrompt';

describe('FoldSummaryPrompt', () => {
  it('builds the running-summary prompt with role + content folded messages', () => {
    const prompt = buildFoldSummaryPrompt({
      topic: 'Coffee',
      previousSummary: 'Talked about favorite drinks.',
      messages: [
        { role: 'assistant', content: 'Do you like coffee?' },
        { role: 'user', content: 'Yes, a lot!' },
      ],
    });

    assert.match(prompt, /You're a summarizer/);
    assert.match(prompt, /Conversation topic: Coffee/);
    assert.match(prompt, /Previous summary:\nTalked about favorite drinks\./);
    assert.match(prompt, /assistant: Do you like coffee\?/);
    assert.match(prompt, /user: Yes, a lot!/);
    assert.match(prompt, /Preserve any point from the previous summary/);
  });

  it('marks the first compression as empty and omits the topic when absent', () => {
    const prompt = buildFoldSummaryPrompt({
      messages: [{ role: 'user', content: 'hi' }],
    });

    assert.match(prompt, /Previous summary: \(empty/);
    assert.doesNotMatch(prompt, /Conversation topic:/);
  });
});
