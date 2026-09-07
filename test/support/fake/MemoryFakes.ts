import {
  ApplyMemoryCandidatesInput,
  MemoryCandidate,
  MemoryRecord,
  MemoryRepository,
  MemorySourceMessage,
} from '../../../app/module/memory/service/MemoryPorts';
import { Memory } from '../../../app/module/memory/domain/Memory';

export class InMemoryMemoryRepository extends MemoryRepository {
  readonly items: MemoryRecord[] = [];
  readonly sources = new Map<string, Set<string>>();
  readonly changes: Array<{ memoryId: string; action: string }> = [];
  unscannedMessages: MemorySourceMessage[] = [];
  extractionMessages: MemorySourceMessage[] = [];
  readonly memoryScanCursors = new Map<string, number>();

  pendingMessages(userId?: string, conversationId?: string): MemorySourceMessage[] {
    return this.unscannedMessages.filter(message => {
      if (userId && message.userId !== userId) return false;
      if (conversationId && message.conversationId !== conversationId) return false;
      const cursor = this.memoryScanCursors.get(`${message.userId}\u0000${message.conversationId}`) ?? 0;
      return message.sequence > cursor;
    });
  }

  async list(userId: string, now: Date): Promise<MemoryRecord[]> {
    return this.items.filter(item => item.userId === userId
      && item.status === 'active' && (!item.expiresAt || item.expiresAt > now));
  }

  async update(userId: string, id: string, content: string, summary: string, now: Date) {
    const item = this.items.find(value => value.id === id && value.userId === userId
      && value.status === 'active');
    if (!item) return null;
    item.content = content;
    item.summary = summary;
    item.updatedAt = now;
    this.changes.push({ memoryId: id, action: 'correct' });
    return { ...item };
  }

  async delete(userId: string, id: string, now: Date): Promise<boolean> {
    const item = this.items.find(value => value.id === id && value.userId === userId
      && value.status === 'active');
    if (!item) return false;
    item.status = 'deleted';
    item.deletedAt = now;
    item.updatedAt = now;
    this.changes.push({ memoryId: id, action: 'delete' });
    return true;
  }

  async loadPendingMemoryGroups(input: {
    userId: string;
    minimumMessages: number;
    maximumMessagesPerGroup: number;
    maximumGroups: number;
  }) {
    const grouped = new Map<string, MemorySourceMessage[]>();
    for (const message of this.pendingMessages(input.userId)) {
      const key = `${message.userId}\u0000${message.conversationId}`;
      const group = grouped.get(key) ?? [];
      group.push(message);
      grouped.set(key, group);
    }
    return [ ...grouped.values() ]
      .filter(group => group.length >= input.minimumMessages)
      .sort((left, right) => left[0].createdAt.getTime() - right[0].createdAt.getTime())
      .slice(0, input.maximumGroups)
      .map(group => ({
        userId: group[0].userId,
        conversationId: group[0].conversationId,
        targetMessages: [ ...group ]
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()
            || left.sequence - right.sequence)
          .slice(0, input.maximumMessagesPerGroup),
      }));
  }

  async loadExtractionContext(
    conversationId: string,
    userId: string,
    targetMessages: MemorySourceMessage[],
  ) {
    if (!targetMessages.length) return [];
    return this.extractionMessages.filter(item => item.conversationId === conversationId
      && item.userId === userId);
  }

  async advanceMemoryScanCursor(userId: string, conversationId: string, throughSequence: number) {
    const key = `${userId}\u0000${conversationId}`;
    this.memoryScanCursors.set(key, Math.max(this.memoryScanCursors.get(key) ?? 0, throughSequence));
  }

  async applyCandidates(input: ApplyMemoryCandidatesInput): Promise<MemoryRecord[]> {
    const changed: MemoryRecord[] = [];
    const context = { now: input.now, expiryFor: input.expiryFor };
    for (const candidate of input.candidates) {
      const matching = this.items.find(item => item.userId === input.userId
        && item.type === candidate.type && item.normalizedKey === candidate.normalizedKey);
      const sourceIds = new Set(candidate.sourceMessageIds);
      if (matching) {
        // 状态转换规则全部委托给充血领域类 Memory。
        // 两个分支顺序语义不同（对齐原实现与 MySQL 版）：
        // - active：先记录新来源，再判断 summary 是否有变更；
        // - deleted/superseded：先用旧来源集合判断是否全部已知（全部已知则不复活）。
        const current = Memory.fromRecord(matching);
        if (current.status === 'active') {
          const known = this.sources.get(matching.id) ?? new Set<string>();
          for (const id of sourceIds) known.add(id);
          this.sources.set(matching.id, known);
          const after = current.mergeWith(candidate, context);
          if (!after) continue;
          this.changes.push({ memoryId: matching.id, action: 'replace' });
          changed.push(after.toRecord());
          Object.assign(matching, after.toRecord());
          continue;
        }
        const known = this.sources.get(matching.id) ?? new Set<string>();
        const after = current.reactivate(candidate, context, known);
        if (!after) continue;
        for (const id of sourceIds) known.add(id);
        this.sources.set(matching.id, known);
        this.changes.push({ memoryId: matching.id, action: matching.status === 'deleted' ? 'add' : 'restore' });
        changed.push(after.toRecord());
        Object.assign(matching, after.toRecord());
        continue;
      }
      const item = input.create(candidate);
      this.items.push(item);
      this.sources.set(item.id, sourceIds);
      this.changes.push({ memoryId: item.id, action: 'add' });
      changed.push({ ...item });
    }
    for (const type of new Set(input.candidates.map(item => item.type))) {
      const limit = input.limitFor(type);
      if (limit === undefined) continue;
      const active = this.items.filter(item => item.userId === input.userId
        && item.type === type && item.status === 'active'
        && (!item.expiresAt || item.expiresAt > input.now))
        .sort((left, right) => right.admissionScore - left.admissionScore
          || Number(right.explicitlyRequested) - Number(left.explicitlyRequested)
          || right.updatedAt.getTime() - left.updatedAt.getTime()
          || right.createdAt.getTime() - left.createdAt.getTime()
          || right.id.localeCompare(left.id));
      for (const item of active.slice(limit)) {
        const evicted = Memory.fromRecord(item).supersede(input.now);
        Object.assign(item, evicted.toRecord());
        this.changes.push({ memoryId: item.id, action: 'evict' });
      }
    }
    const longTerm = this.items.filter(item => item.userId === input.userId
      && item.type !== 'short_term' && item.status === 'active')
      .sort((left, right) => right.admissionScore - left.admissionScore
        || Number(right.explicitlyRequested) - Number(left.explicitlyRequested)
        || right.updatedAt.getTime() - left.updatedAt.getTime()
        || right.createdAt.getTime() - left.createdAt.getTime()
        || right.id.localeCompare(left.id));
    for (const item of longTerm.slice(input.longTermLimit)) {
      const evicted = Memory.fromRecord(item).supersede(input.now);
      Object.assign(item, evicted.toRecord());
      this.changes.push({ memoryId: item.id, action: 'evict' });
    }
    return changed;
  }
}

export function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    type: 'preference',
    content: '喜欢在周末徒步',
    summary: 'Enjoys weekend hiking',
    normalizedKey: 'weekend-hiking',
    confidence: 0.9,
    admissionScore: 7,
    explicitlyRequested: false,
    admissionReason: 'Stable preference',
    assessmentJson: '{}',
    sourceMessageIds: [ '01MESSAGE' ],
    ...overrides,
  };
}
