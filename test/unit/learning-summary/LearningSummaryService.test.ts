import { strict as assert } from 'node:assert';
import {
  LearningSummaryService,
  shanghaiDate,
  shanghaiDateRange,
} from '../../../app/module/learning-summary/service/LearningSummaryService';
import type {
  DailyLearningMetrics,
  DailyLearningSummaryRecord,
  SummaryDateRange,
} from '../../../app/module/learning-summary/service/LearningSummaryPorts';
import { LearningSummaryRepository } from '../../../app/module/learning-summary/service/LearningSummaryPorts';
import { FakeClock, FixedIdGenerator } from '../../support/fake/AccountFakes';
import { FakeProductAIService } from '../../support/fake/ConversationFakes';

const baseMetrics: DailyLearningMetrics = {
  conversationCount: 1,
  userMessageCount: 4,
  chatTokens: 320,
  grammarErrorCount: 1,
  grammar: [{
    errorType: 'tense', count: 1, examples: [{
      errorType: 'tense', original: 'Yesterday I go.', corrected: 'Yesterday I went.',
      note: '过去发生的事情使用过去式。',
    }],
  }],
  newVocabularyCount: 1,
  newVocabulary: [ 'almost late' ],
  reviewedCount: 2,
  reviewResults: { again: 0, hard: 1, good: 1, easy: 0 },
};

class InMemoryLearningSummaryRepository extends LearningSummaryRepository {
  metrics: DailyLearningMetrics | null = baseMetrics;
  readonly records = new Map<string, DailyLearningSummaryRecord>();
  activeUsers: string[] = [];

  async aggregate(userId: string, range: SummaryDateRange) {
    void userId;
    void range;
    return this.metrics ? structuredClone(this.metrics) : null;
  }

  async find(userId: string, date: string) {
    return this.records.get(`${userId}:${date}`) ?? null;
  }

  async list(userId: string, cursor: string | undefined, limit: number) {
    return [ ...this.records.values() ]
      .filter(item => item.userId === userId && (!cursor || item.summaryDate < cursor))
      .sort((a, b) => b.summaryDate.localeCompare(a.summaryDate))
      .slice(0, limit);
  }

  async claim(input: {
    id: string; userId: string; date: string; timezone: string; sourceVersion: string;
    metrics: DailyLearningMetrics; now: Date;
  }) {
    const key = `${input.userId}:${input.date}`;
    const current = this.records.get(key);
    if (current?.finalizedAt || (
      current?.status === 'completed' && current.sourceVersion === input.sourceVersion
    )) return false;
    this.records.set(key, {
      id: current?.id ?? input.id,
      userId: input.userId,
      summaryDate: input.date,
      timezone: input.timezone,
      status: 'generating',
      sourceVersion: input.sourceVersion,
      metrics: structuredClone(input.metrics),
      retryCount: current?.retryCount ?? 0,
      createdAt: current?.createdAt ?? input.now,
      updatedAt: input.now,
    });
    return true;
  }

  async complete(input: {
    userId: string; date: string; sourceVersion: string;
    content: DailyLearningSummaryRecord['content'];
    usage: NonNullable<DailyLearningSummaryRecord['usage']>; now: Date;
  }) {
    const key = `${input.userId}:${input.date}`;
    const current = this.records.get(key);
    if (!current || !input.content) throw new Error('summary missing');
    this.records.set(key, {
      ...current, status: 'completed', content: input.content, usage: input.usage,
      generatedAt: input.now, updatedAt: input.now,
    });
  }

  async listRecentlyActiveUserIds() {
    return this.activeUsers;
  }

  async finalizeBefore(date: string, now: Date) {
    for (const [ key, record ] of this.records) {
      if (record.summaryDate < date && record.status === 'completed') {
        this.records.set(key, { ...record, finalizedAt: now, updatedAt: now });
      }
    }
  }
}

describe('LearningSummaryService', () => {
  const now = new Date('2026-08-11T02:00:00.000Z');

  function setup() {
    const repository = new InMemoryLearningSummaryRepository();
    const ai = new FakeProductAIService();
    const service = new LearningSummaryService(
      repository, ai, new FixedIdGenerator([ '01SUMMARYA', '01SUMMARYB' ]), new FakeClock(now),
    );
    return { repository, ai, service };
  }

  it('uses Asia/Shanghai calendar boundaries', () => {
    assert.equal(shanghaiDate(new Date('2026-08-10T15:59:59.999Z')), '2026-08-10');
    assert.equal(shanghaiDate(new Date('2026-08-10T16:00:00.000Z')), '2026-08-11');
    const range = shanghaiDateRange('2026-08-11');
    assert.equal(range.from.toISOString(), '2026-08-10T16:00:00.000Z');
    assert.equal(range.to.toISOString(), '2026-08-11T16:00:00.000Z');
  });

  it('generates today once and reuses it while source metrics stay unchanged', async () => {
    const { ai, service } = setup();

    const first = await service.today('01USER');
    const replay = await service.today('01USER');

    assert.equal(first?.date, '2026-08-11');
    assert.equal(first?.status, 'completed');
    assert.equal(first?.metrics.chatTokens, 320);
    assert.equal(replay?.id, first?.id);
    assert.equal(ai.dailyLearningSummaryCalls, 1);
  });

  it('regenerates the current day when learning metrics change', async () => {
    const { ai, repository, service } = setup();
    await service.today('01USER');
    repository.metrics = { ...baseMetrics, userMessageCount: 5 };

    const refreshed = await service.today('01USER');

    assert.equal(refreshed?.metrics.userMessageCount, 5);
    assert.equal(ai.dailyLearningSummaryCalls, 2);
  });

  it('returns null without calling AI when the day has no learning activity', async () => {
    const { ai, repository, service } = setup();
    repository.metrics = null;

    assert.equal(await service.today('01USER'), null);
    assert.equal(ai.dailyLearningSummaryCalls, 0);
  });

  it('falls back to a deterministic summary when AI generation fails', async () => {
    const { ai, service } = setup();
    ai.generateDailyLearningSummary = async () => {
      throw new Error('provider unavailable');
    };

    const summary = await service.today('01USER');

    assert.equal(summary?.status, 'completed');
    assert.match(summary?.content?.headline ?? '', /英语练习/);
  });

  it('refreshes recent user days and finalizes completed historical summaries', async () => {
    const { repository, service } = setup();
    repository.activeUsers = [ '01USER' ];

    await service.processRecent();

    assert.ok((await repository.find('01USER', '2026-08-10'))?.finalizedAt);
    assert.equal((await repository.find('01USER', '2026-08-11'))?.finalizedAt, undefined);
  });
});
