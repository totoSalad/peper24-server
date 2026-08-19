import type { LanguageModel } from 'ai';

export interface ResolvedTextModel {
  model: LanguageModel;
  provider: string;
  modelId: string;
}

export type TextModelPurpose = 'default' | 'translation';

export abstract class TextModelProvider {
  abstract resolve(purpose?: TextModelPurpose): ResolvedTextModel;
}
