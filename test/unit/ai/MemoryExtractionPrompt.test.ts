import { strict as assert } from 'node:assert';
import { buildMemoryExtractionPrompt } from '../../../app/module/ai/prompt/MemoryExtractionPrompt';

describe('MemoryExtractionPrompt', () => {
  it('sets a high bar for cross-conversation value and prefers omission', () => {
    const prompt = buildMemoryExtractionPrompt({
      targetMessageIds: [ 'u1' ],
      messages: [{ id: 'u1', role: 'user', content: '今天午饭吃了面。' }],
      existingMemories: [],
    });

    assert.match(prompt, /useful in a future conversation/i);
    assert.match(prompt, /prefer shouldSave=false/i);
    assert.match(prompt, /one-off meal/i);
    assert.match(prompt, /one or two.*decisions/i);
    assert.match(prompt, /prefer one strong decision.*weak second/i);
    assert.match(prompt, /like, prefer, or favorite.*personal importance or future value/i);
    assert.match(prompt, /score sum minus 2 per penalty >= 4/i);
    assert.doesNotMatch(prompt, /\bstabl(?:e|ity)\b/i);
  });

  it('asks the model to keep each saved decision cohesive and distinct', () => {
    const prompt = buildMemoryExtractionPrompt({
      targetMessageIds: [ 'u1' ],
      messages: [{
        id: 'u1',
        role: 'user',
        content: '我明年想考到雅思 7 分，然后申请英国的研究生。',
      }],
      existingMemories: [],
    });

    assert.match(prompt, /distinct type \+ normalizedKey/i);
  });

  it('separates source-faithful content from a concise habit summary', () => {
    const prompt = buildMemoryExtractionPrompt({
      targetMessageIds: [ 'u1' ],
      messages: [{
        id: 'u1',
        role: 'user',
        content: 'Eating too much makes me feel too full and causes poor sleep.',
      }],
      existingMemories: [],
    });

    assert.match(prompt, /do not output content/i);
    assert.match(prompt, /summary.*concise/i);
    assert.match(prompt, /server copies source-message text/i);
  });

  it('treats existing memories as a reason to suppress unchanged duplicates', () => {
    const prompt = buildMemoryExtractionPrompt({
      targetMessageIds: [ 'u1' ],
      messages: [{ id: 'u1', role: 'user', content: '我还是住在上海。' }],
      existingMemories: [{
        type: 'profile', content: '住在上海', summary: 'Lives in Shanghai', normalizedKey: 'home-city',
      }],
    });

    assert.match(prompt, /existing memory is unchanged.*shouldSave=false/i);
    assert.match(prompt, /materially changed.*reuse its semantic key/i);
  });
});
