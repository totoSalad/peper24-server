import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import type { LearnerMemory } from '../../ai/service/ProductAIService';
import { AppError } from '../../system/error/AppError';
import { Clock, IdGenerator } from '../../system/service/SystemPorts';
import {
  MemoryCandidate,
  MemoryRecord,
  MemoryRepository,
  MemoryType,
} from './MemoryPorts';

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeMemoryKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function expiryForMemory(
  type: MemoryType,
  now: Date,
  temporaryDays: 7 | 14 | 30 = 7,
): Date | undefined {
  if (type !== 'short_term') return undefined;
  return new Date(now.getTime() + temporaryDays * DAY_MS);
}

export function limitForMemory(type: MemoryType): number | undefined {
  return { profile: 10, preference: 5, significant_fact: 10, short_term: 10 }[type];
}

@SingletonProto({ accessLevel: AccessLevel.PUBLIC })
export class MemoryService {
  constructor(
    @Inject('MemoryRepository') private readonly memories: MemoryRepository,
    @Inject('IdGenerator') private readonly ids: IdGenerator,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async list(userId: string) {
    return (await this.memories.list(userId, this.clock.now())).map(item => this.toPublic(item));
  }

  async listForExtraction(userId: string) {
    return (await this.memories.list(userId, this.clock.now())).map(item => ({
      type: item.type,
      content: item.content,
      summary: item.summary,
      normalizedKey: item.normalizedKey,
    }));
  }

  /** 活跃记忆（带类型），作为 Prompt 第⑤层的注入数据。 */
  async context(userId: string): Promise<LearnerMemory[]> {
    return (await this.memories.list(userId, this.clock.now())).map(item => ({
      type: item.type,
      content: item.summary,
    }));
  }

  async correct(userId: string, id: string, rawContent: string, rawSummary?: string) {
    const content = rawContent.trim();
    const summary = (rawSummary ?? rawContent).trim();
    if (!content || content.length > 500) {
      throw new AppError('INVALID_MEMORY_CONTENT', '记忆内容长度必须是 1 到 500 个字符');
    }
    if (!summary || summary.length > 500) {
      throw new AppError('INVALID_MEMORY_SUMMARY', '记忆总结长度必须是 1 到 500 个字符');
    }
    const updated = await this.memories.update(
      userId, id, content, summary, this.clock.now(),
    );
    if (!updated) throw new AppError('MEMORY_NOT_FOUND', '记忆不存在', 404);
    return this.toPublic(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const removed = await this.memories.delete(userId, id, this.clock.now());
    if (!removed) throw new AppError('MEMORY_NOT_FOUND', '记忆不存在', 404);
  }

  async applyCandidates(userId: string, rawCandidates: MemoryCandidate[]) {
    const now = this.clock.now();
    const normalized = rawCandidates.slice(0, 2).map(item => ({
      ...item,
      content: item.content.trim(),
      summary: item.summary.trim(),
      normalizedKey: normalizeMemoryKey(item.normalizedKey || item.content),
      sourceMessageIds: [ ...new Set(item.sourceMessageIds) ],
    })).filter(item => item.content && item.summary && item.normalizedKey
      && item.sourceMessageIds.length > 0);
    const seen = new Set<string>();
    const candidates = normalized.filter(item => {
      const slot = `${item.type}\u0000${item.normalizedKey}`;
      if (seen.has(slot)) return false;
      seen.add(slot);
      return true;
    });
    return this.memories.applyCandidates({
      userId,
      candidates,
      now,
      expiryFor: candidate => expiryForMemory(candidate.type, now, candidate.temporaryDays),
      limitFor: limitForMemory,
      longTermLimit: 25,
      create: candidate => ({
        id: this.ids.next(),
        userId,
        type: candidate.type,
        content: candidate.content,
        summary: candidate.summary,
        normalizedKey: candidate.normalizedKey,
        confidence: candidate.confidence,
        admissionScore: candidate.admissionScore,
        explicitlyRequested: candidate.explicitlyRequested,
        admissionReason: candidate.admissionReason,
        assessmentJson: candidate.assessmentJson,
        status: 'active',
        expiresAt: expiryForMemory(candidate.type, now, candidate.temporaryDays),
        createdAt: now,
        updatedAt: now,
      }),
    });
  }

  private toPublic(item: MemoryRecord) {
    return {
      id: item.id,
      type: item.type,
      content: item.content,
      summary: item.summary,
      confidence: item.confidence,
      expiresAt: item.expiresAt?.toISOString(),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}
