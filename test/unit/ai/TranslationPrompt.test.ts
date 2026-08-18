import { strict as assert } from 'node:assert';
import { buildTranslationPrompt } from '../../../app/module/ai/prompt/TranslationPrompt';

describe('buildTranslationPrompt', () => {
  it('requires a bare-text translation without JSON framing', () => {
    const prompt = buildTranslationPrompt({
      content: 'Shopping list:\n- apples\n- milk',
      targetLanguage: 'Chinese',
    });

    assert.match(prompt, /entire response must be the translated text itself/i);
    assert.match(prompt, /do not output JSON/i);
    assert.match(prompt, /preserve.*line breaks.*list markers/i);
    assert.match(prompt, /Shopping list:\n- apples\n- milk/u);
    assert.doesNotMatch(prompt, /\{"content":/u);
  });
});
