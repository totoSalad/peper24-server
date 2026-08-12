import type { TranslationInput } from '../service/ProductAIService';

export function buildTranslationPrompt(input: TranslationInput): string {
  return [
    'Translate the message faithfully and naturally.',
    `Target language: ${input.targetLanguage}.`,
    'Preserve meaning, tone, names, numbers, and formatting.',
    'Return only the structured translation requested by the schema.',
    '<message>',
    JSON.stringify({ content: input.content }),
    '</message>',
  ].join('\n');
}
