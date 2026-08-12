import type { LanguageModel } from 'ai';

export interface ResolvedTextModel {
  model: LanguageModel;
  provider: string;
  modelId: string;
}

export abstract class TextModelProvider {
  abstract resolve(): ResolvedTextModel | null;
}
