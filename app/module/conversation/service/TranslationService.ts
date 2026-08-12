import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import { ProductAIService } from '../../ai/service/ProductAIService';
import { AppError } from '../../system/error/AppError';
import { Clock } from '../../system/service/SystemPorts';
import { ConversationRepository } from './ConversationPorts';

export function translationTarget(content: string): 'Chinese' | 'English' {
  return /[\u3400-\u9fff]/u.test(content) ? 'English' : 'Chinese';
}

@SingletonProto({ accessLevel: AccessLevel.PUBLIC })
export class TranslationService {
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    @Inject('ConversationRepository') private readonly messages: ConversationRepository,
    @Inject('ProductAIService') private readonly ai: ProductAIService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async translateMessage(userId: string, messageId: string): Promise<{ translation: string }> {
    const message = await this.messages.findMessageForTranslation(userId, messageId);
    if (!message) throw new AppError('MESSAGE_NOT_FOUND', '消息不存在', 404);
    if (message.translation) return { translation: message.translation };
    const key = `${userId}:${messageId}`;
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.generateAndSave(userId, messageId, message.content);
      this.inFlight.set(key, pending);
    }
    try {
      return { translation: await pending };
    } finally {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    }
  }

  private async generateAndSave(userId: string, messageId: string, content: string): Promise<string> {
    let generated;
    try {
      generated = await this.ai.translate({ content, targetLanguage: translationTarget(content) });
    } catch {
      throw new AppError('TRANSLATION_FAILED', '暂时无法翻译，请稍后重试', 502);
    }
    const translation = generated.translation.trim();
    if (!translation) throw new AppError('TRANSLATION_FAILED', '翻译结果为空', 502);
    const saved = await this.messages.saveTranslation(
      userId, messageId, translation, this.clock.now(),
    );
    if (!saved) throw new AppError('MESSAGE_NOT_FOUND', '消息不存在', 404);
    return saved.translation ?? translation;
  }
}
