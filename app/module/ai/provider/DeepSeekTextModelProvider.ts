import { createDeepSeek } from '@ai-sdk/deepseek';
import { AccessLevel, SingletonProto } from '@eggjs/tegg';
import { AppError } from '../../system/error/AppError';
import { ResolvedTextModel, TextModelProvider } from './TextModelProvider';

@SingletonProto({ name: 'TextModelProvider', accessLevel: AccessLevel.PUBLIC })
export class DeepSeekTextModelProvider extends TextModelProvider {
  private resolved?: ResolvedTextModel;

  resolve(): ResolvedTextModel | null {
    const provider = process.env.AI_TEXT_PROVIDER
      ?? (process.env.NODE_ENV === 'production' ? 'deepseek' : 'development');
    if (provider === 'development') return null;
    if (provider !== 'deepseek') {
      throw new AppError('AI_PROVIDER_INVALID', `不支持的 AI Provider: ${provider}`, 503);
    }
    if (this.resolved) return this.resolved;

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new AppError('AI_PROVIDER_UNAVAILABLE', 'DeepSeek API Key 尚未配置', 503);
    }
    const modelId = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
    const deepseek = createDeepSeek({
      apiKey,
      ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}),
    });
    this.resolved = { model: deepseek(modelId), provider: 'deepseek', modelId };
    return this.resolved;
  }
}
