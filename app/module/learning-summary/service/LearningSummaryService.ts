import { createHash } from 'node:crypto';
import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import type {
  DailyLearningSummaryGeneration,
  DailyLearningSummaryInput,
} from '../../ai/service/ProductAIService';
import { ProductAIService } from '../../ai/service/ProductAIService';
import { AppError } from '../../system/error/AppError';
import { Clock, IdGenerator } from '../../system/service/SystemPorts';
import type {
  DailyLearningMetrics,
  DailyLearningSummaryContent,
  DailyLearningSummaryRecord,
  SummaryDateRange,
} from './LearningSummaryPorts';
import { LearningSummaryRepository } from './LearningSummaryPorts';

export const LEARNING_SUMMARY_TIMEZONE = 'Asia/Shanghai';
const SHANGHAI_OFFSET = '+08:00';
const GENERATION_LOOKBACK_DAYS = 2;
const WORKER_CONCURRENCY = 5;

export function shanghaiDate(value: Date): string {
  return new Date(value.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function shanghaiDateRange(date: string): SummaryDateRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError('INVALID_SUMMARY_DATE', '小结日期格式必须是 YYYY-MM-DD');
  }
  const from = new Date(`${date}T00:00:00${SHANGHAI_OFFSET}`);
  if (Number.isNaN(from.getTime()) || shanghaiDate(from) !== date) {
    throw new AppError('INVALID_SUMMARY_DATE', '小结日期不正确');
  }
  return { date, from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

@SingletonProto({ accessLevel: AccessLevel.PUBLIC })
export class LearningSummaryService {
  constructor(
    @Inject('LearningSummaryRepository') private readonly summaries: LearningSummaryRepository,
    @Inject('ProductAIService') private readonly ai: ProductAIService,
    @Inject('IdGenerator') private readonly ids: IdGenerator,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async today(userId: string) {
    return this.refresh(userId, shanghaiDate(this.clock.now()));
  }

  async get(userId: string, date: string) {
    const today = shanghaiDate(this.clock.now());
    if (date > today) throw new AppError('SUMMARY_NOT_FOUND', '学习小结不存在', 404);
    return this.refresh(userId, date);
  }

  async list(userId: string, cursor?: string, limit = 20) {
    if (cursor) shanghaiDateRange(cursor);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new AppError('INVALID_SUMMARY_LIMIT', '小结分页数量必须是 1 到 50');
    }
    return (await this.summaries.list(userId, cursor, limit)).map(item => this.toResponse(item));
  }

  async refresh(userId: string, date: string) {
    const range = shanghaiDateRange(date);
    const metrics = await this.summaries.aggregate(userId, range);
    if (!metrics) return null;
    const sourceVersion = this.sourceVersion(metrics);
    const existing = await this.summaries.find(userId, date);
    if (existing?.finalizedAt || (
      existing?.status === 'completed' && existing.sourceVersion === sourceVersion
    )) {
      return this.toResponse(existing);
    }

    const now = this.clock.now();
    const claimed = await this.summaries.claim({
      id: existing?.id ?? this.ids.next(),
      userId,
      date,
      timezone: LEARNING_SUMMARY_TIMEZONE,
      sourceVersion,
      metrics,
      now,
    });
    if (!claimed) {
      const current = await this.summaries.find(userId, date);
      return current ? this.toResponse(current) : null;
    }

    const generated = await this.generate(date, metrics);
    await this.summaries.complete({
      userId,
      date,
      sourceVersion,
      content: generated.content,
      usage: generated.usage,
      now: this.clock.now(),
    });
    const completed = await this.summaries.find(userId, date);
    if (!completed) throw new Error('daily learning summary missing after completion');
    return this.toResponse(completed);
  }

  async processRecent(): Promise<void> {
    const now = this.clock.now();
    const today = shanghaiDate(now);
    const todayRange = shanghaiDateRange(today);
    const from = new Date(todayRange.from.getTime() - GENERATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const users = await this.summaries.listRecentlyActiveUserIds(from, todayRange.to);
    const yesterday = shanghaiDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    for (let index = 0; index < users.length; index += WORKER_CONCURRENCY) {
      const batch = users.slice(index, index + WORKER_CONCURRENCY);
      await Promise.allSettled(batch.flatMap(userId => [
        this.refresh(userId, yesterday),
        this.refresh(userId, today),
      ]));
    }
    await this.summaries.finalizeBefore(today, now);
  }

  private sourceVersion(metrics: DailyLearningMetrics): string {
    return createHash('sha256').update(JSON.stringify(metrics)).digest('hex');
  }

  private async generate(
    date: string,
    metrics: DailyLearningMetrics,
  ): Promise<DailyLearningSummaryGeneration> {
    const input: DailyLearningSummaryInput = { date, timezone: LEARNING_SUMMARY_TIMEZONE, metrics };
    try {
      return await this.ai.generateDailyLearningSummary(input);
    } catch {
      return {
        content: this.fallback(metrics),
        usage: {
          provider: 'peper24', model: 'deterministic-summary', inputTokens: 0, outputTokens: 0,
        },
      };
    }
  }

  private fallback(metrics: DailyLearningMetrics): DailyLearningSummaryContent {
    const highlights = [
      `完成了 ${metrics.conversationCount} 次对话，共发送 ${metrics.userMessageCount} 条消息。`,
    ];
    if (metrics.newVocabularyCount) highlights.push(`新增了 ${metrics.newVocabularyCount} 个表达。`);
    if (metrics.reviewedCount) highlights.push(`完成了 ${metrics.reviewedCount} 次词汇复习。`);
    const mainGrammar = metrics.grammar[0];
    return {
      headline: metrics.userMessageCount >= 10 ? '今天完成了扎实的英语练习' : '今天保持了英语练习',
      highlights: highlights.slice(0, 3),
      improvements: mainGrammar
        ? [ `继续注意 ${mainGrammar.errorType}，今天出现了 ${mainGrammar.count} 次。` ]
        : [ '今天没有发现需要主动提醒的重复语法问题。' ],
      nextSteps: metrics.newVocabularyCount
        ? [ '明天优先复习今天新增的表达。' ]
        : [ '明天继续完成一次短对话，保持练习节奏。' ],
    };
  }

  private toResponse(record: DailyLearningSummaryRecord) {
    return {
      id: record.id,
      date: record.summaryDate,
      timezone: record.timezone,
      status: record.status,
      finalized: Boolean(record.finalizedAt),
      metrics: record.metrics,
      content: record.content,
      generatedAt: record.generatedAt?.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
