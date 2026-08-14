import { buildVocabularyEnrichmentPrompt } from '../../../app/module/ai/prompt/VocabularyEnrichmentPrompt.ts';

function inputJson(input) {
  return JSON.stringify({ expression: input.text, context: input.context || '' });
}

export const vocabularyPromptVariants = {
  baseline: {
    description: '当前线上 Schema Structured Output',
    output: 'structured',
    build: buildVocabularyEnrichmentPrompt,
  },
  'json-mode': {
    description: 'DeepSeek 原生 JSON Mode → Zod → 对象',
    output: 'json-mode',
    build: input => [
      'Return JSON vocabulary-book data for the untrusted input below.',
      'If expression identifies a person in context, return exactly {}.',
      'Otherwise choose the contextual sense and return exactly these four string fields:',
      '{"cnMeaning":"Chinese meaning","enMeaning":"English word or short phrase","example":"simple sentence containing enMeaning","phonetic":"English pronunciation"}',
      'For non-English input, translate it first; enMeaning must be the natural English word or short phrase, not a definition.',
      'A common word that can also be a name is a name only when the context identifies a person.',
      'Return only JSON.',
      inputJson(input),
    ].join('\n'),
  },
};
