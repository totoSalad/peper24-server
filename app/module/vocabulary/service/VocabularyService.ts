import { AccessLevel, Inject, Logger, SingletonProto } from '@eggjs/tegg';
import {
  ProductAIService,
  type LearnerContext,
  type VocabularyEnrichment,
} from '../../ai/service/ProductAIService';
import { AppError } from '../../system/error/AppError';
import { Clock, IdGenerator } from '../../system/service/SystemPorts';
import {
  type ReviewResult,
  VocabularyRepository,
} from './VocabularyPorts';

const reviewScores: Record<ReviewResult, number> = {
  again: 0,
  hard: 2,
  good: 3,
  easy: 5,
};

// 词本只收「词/短表达」：中文输入转换出的 enMeaning 超过该长度说明是释义长句而非词本身。
const MAX_EXPRESSION_LENGTH = 60;

export function normalizeExpression(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

// 生词本只收录英文表达:含中日韩(CJK/Hiragana/Katakana/Hangul)字符即视为非英文。
const NON_ENGLISH_SCRIPT = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ가-힯]/;

export function isEnglishExpression(value: string): boolean {
  return !NON_ENGLISH_SCRIPT.test(value);
}

@SingletonProto({ name: 'VocabularyService', accessLevel: AccessLevel.PUBLIC })
export class VocabularyService {
  constructor(
    @Inject('VocabularyRepository') private readonly repository: VocabularyRepository,
    @Inject('ProductAIService') private readonly ai: ProductAIService,
    @Inject('IdGenerator') private readonly ids: IdGenerator,
    @Inject('Clock') private readonly clock: Clock,
    @Inject('aiLogger') private readonly aiLogger: Logger,
  ) {}

  async addFromSelection(
    userId: string,
    expression: string,
    sourceMessageId: string,
    learner?: LearnerContext,
  ) {
    const selected = expression.trim();
    if (!selected || selected.length > 200) {
      throw new AppError('INVALID_EXPRESSION', '表达长度必须是 1 到 200 个字符');
    }
    const source = await this.repository.findSourceMessage(userId, sourceMessageId);
    if (!source) throw new AppError('MESSAGE_NOT_FOUND', '消息不存在', 404);
    if (!normalizeExpression(source.content).includes(normalizeExpression(selected))) {
      throw new AppError('EXPRESSION_NOT_IN_MESSAGE', '选中的表达不在来源消息中');
    }
    let resolved: { expression: string; info: VocabularyEnrichment } | null;
    try {
      resolved = await this.enrichExpression(selected, source.content, learner);
    } catch (error) {
      // generateTextWithRetry already owns transient-error retries; retrying
      // here would duplicate a permanent failure (e.g. invalid JSON from the
      // provider) into a second paid AI call. Log the root cause instead.
      this.aiLogger.error(
        '[vocabulary-enrich] enrichVocabulary failed: %s',
        error instanceof Error ? error.message : String(error),
      );
      throw new AppError(
        'VOCABULARY_ENRICHMENT_FAILED',
        '暂时无法补充这个表达，请稍后重试',
        502,
      );
    }
    if (!resolved) return null;
    return this.saveEnriched(userId, resolved.expression, source, resolved.info);
  }

  /**
   * 一次 AI 调用完成 enrich：模型会对非英文输入先翻译成英文表达（enMeaning），
   * 因此词本表达式永远取英文形式——输入是英文用原文，否则用 enMeaning。
   */
  async enrichExpression(
    text: string,
    context: string,
    learner?: LearnerContext,
  ): Promise<{ expression: string; info: VocabularyEnrichment } | null> {
    const info = await this.ai.enrichVocabulary({ text, context, learner });
    if (!info) {
      this.aiLogger.info(
        '[vocabulary-enrich] skipped empty result, likely person name text=%j',
        text.trim(),
      );
      return null;
    }
    const trimmed = text.trim();
    if (isEnglishExpression(trimmed)) return { expression: trimmed, info };
    const expression = info.enMeaning.trim();
    // 非英文输入时 enMeaning 必须是干净的英文词/短语——过长说明模型给了释义而非词本身。
    if (!expression || !isEnglishExpression(expression) || expression.length > MAX_EXPRESSION_LENGTH) {
      throw new AppError('VOCABULARY_ENRICHMENT_FAILED', '无法确定该表达的英文形式', 502);
    }
    return { expression, info };
  }

  async addFromTool(
    userId: string,
    expression: string,
    info: VocabularyEnrichment,
    sourceMessageId: string,
    sourceContent: string,
  ) {
    return this.saveEnriched(
      userId,
      expression,
      { id: sourceMessageId, content: sourceContent },
      info,
    );
  }

  private async saveEnriched(
    userId: string,
    originalExpression: string,
    source: { id: string; content: string },
    info: VocabularyEnrichment,
  ) {
    const normalizedExpression = normalizeExpression(originalExpression);
    if (!normalizedExpression) {
      throw new AppError('VOCABULARY_ENRICHMENT_FAILED', '词汇补充结果不完整', 502);
    }
    const now = this.clock.now();
    return this.repository.save({
      vocabulary: {
        id: this.ids.next(),
        userId,
        originalExpression,
        expression: originalExpression,
        normalizedExpression,
        detail: {
          cnMeaning: info.cnMeaning,
          enMeaning: info.enMeaning,
          example: info.example,
          phonetic: info.phonetic,
        },
        lastEncounteredAt: now,
        createdAt: now,
        updatedAt: now,
      },
      context: {
        id: this.ids.next(),
        vocabularyId: '',
        messageId: source.id,
        sentence: source.content,
        createdAt: now,
      },
      initialReviewState: {
        vocabularyId: '',
        repetitions: 0,
        intervalDays: 0,
        easinessFactor: 2.5,
        nextReviewAt: now,
        updatedAt: now,
      },
    });
  }

  async list(userId: string) {
    return this.repository.list(userId);
  }

  async remove(userId: string, vocabularyId: string): Promise<void> {
    if (!(await this.repository.delete(userId, vocabularyId))) {
      throw new AppError('VOCABULARY_NOT_FOUND', '词汇不存在', 404);
    }
  }

  async listDue(userId: string, requestedLimit = 10) {
    const limit = Math.min(10, Math.max(1, Math.trunc(requestedLimit)));
    return this.repository.listDue(userId, this.clock.now(), limit);
  }

  async answer(
    userId: string,
    vocabularyId: string,
    result: ReviewResult,
    clientRequestId: string,
  ) {
    const score = reviewScores[result];
    const outcome = await this.repository.recordReview({
      id: this.ids.next(),
      userId,
      vocabularyId,
      clientRequestId,
      result,
      score,
      reviewedAt: this.clock.now(),
    });
    if (!outcome) throw new AppError('VOCABULARY_NOT_FOUND', '词汇不存在', 404);
    return outcome;
  }
}
