import { strict as assert } from 'node:assert';
import { buildVocabularyEnrichmentPrompt } from '../../../app/module/ai/prompt/VocabularyEnrichmentPrompt';
import { VocabularyEnrichmentSchema } from '../../../app/module/ai/schema/VocabularyEnrichmentSchema';

describe('VocabularyEnrichment prompt and schema', () => {
  it('requires an empty object for a person name without semantic derivation', () => {
    const prompt = buildVocabularyEnrichmentPrompt({
      text: '梁静茹', context: 'She is "梁静茹".',
    });

    assert.match(prompt, /person's name/i);
    assert.match(prompt, /return exactly \{\}/i);
    assert.match(prompt, /do not translate, transliterate, define, infer, or invent/i);
    assert.match(prompt, /"expression":"梁静茹"/);
    assert.equal(VocabularyEnrichmentSchema.safeParse({}).success, true);
  });

  it('still requires every detail field for a normal vocabulary expression', () => {
    assert.equal(VocabularyEnrichmentSchema.safeParse({ cnMeaning: '白萝卜' }).success, false);
    assert.equal(VocabularyEnrichmentSchema.safeParse({
      cnMeaning: '白萝卜', enMeaning: 'daikon radish',
      example: 'This dish uses daikon radish.', phonetic: '/ˈdaɪkɑːn/',
    }).success, true);
  });
});
