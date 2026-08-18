import { createAlibaba } from '@ai-sdk/alibaba';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { AccessLevel, SingletonProto } from '@eggjs/tegg';
import { AppError } from '../../system/error/AppError';
import { ResolvedTextModel, TextModelProvider, TextModelPurpose } from './TextModelProvider';

const DEFAULT_BAILIAN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_BAILIAN_MODEL = 'qwen3.7-flash';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const DEFAULT_PRODUCTION_PROVIDER = 'deepseek';

@SingletonProto({ name: 'TextModelProvider', accessLevel: AccessLevel.PUBLIC })
export class ConfiguredTextModelProvider extends TextModelProvider {
  private readonly resolved = new Map<TextModelPurpose, ResolvedTextModel>();

  resolve(purpose: TextModelPurpose = 'default'): ResolvedTextModel | null {
    const configuredProvider = process.env.AI_TEXT_PROVIDER
      ?? (process.env.NODE_ENV === 'production' ? DEFAULT_PRODUCTION_PROVIDER : 'development');
    if (configuredProvider === 'development') return null;
    if (configuredProvider !== 'bailian' && configuredProvider !== 'deepseek') {
      throw new AppError('AI_PROVIDER_INVALID', `不支持的 AI Provider: ${configuredProvider}`, 503);
    }
    const cached = this.resolved.get(purpose);
    if (cached) return cached;

    // 翻译经过独立模型评测，外部 AI 模式下固定走百炼 Qwen 3.7 Flash；
    // 其他能力仍遵循 AI_TEXT_PROVIDER，避免模型切换影响整条 AI 链路。
    const provider = purpose === 'translation' ? 'bailian' : configuredProvider;

    if (provider === 'bailian') {
      const resolved = this.resolveBailian(purpose);
      this.resolved.set(purpose, resolved);
      return resolved;
    }
    if (provider === 'deepseek') {
      const resolved = this.resolveDeepSeek();
      this.resolved.set(purpose, resolved);
      return resolved;
    }
    throw new AppError('AI_PROVIDER_INVALID', `不支持的 AI Provider: ${provider}`, 503);
  }

  private resolveBailian(purpose: TextModelPurpose): ResolvedTextModel {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new AppError('AI_PROVIDER_UNAVAILABLE', '阿里云百炼 API Key 尚未配置', 503);
    }
    const modelId = purpose === 'translation'
      ? process.env.BAILIAN_TRANSLATION_MODEL ?? DEFAULT_BAILIAN_MODEL
      : process.env.BAILIAN_MODEL ?? DEFAULT_BAILIAN_MODEL;
    const bailian = createAlibaba({
      apiKey,
      baseURL: process.env.BAILIAN_BASE_URL ?? DEFAULT_BAILIAN_BASE_URL,
    });
    return { model: bailian(modelId), provider: 'bailian', modelId };
  }

  private resolveDeepSeek(): ResolvedTextModel {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new AppError('AI_PROVIDER_UNAVAILABLE', 'DeepSeek API Key 尚未配置', 503);
    }
    const modelId = process.env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL;
    const deepseek = createDeepSeek({
      apiKey,
      ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}),
    });
    return { model: deepseek(modelId), provider: 'deepseek', modelId };
  }
}
