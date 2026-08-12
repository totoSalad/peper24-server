import { strict as assert } from 'node:assert';
import { AppError } from '../../../app/module/system/error/AppError';
import {
  expiryForMemory,
  MemoryService,
  normalizeMemoryKey,
} from '../../../app/module/memory/service/MemoryService';
import { FakeClock, FixedIdGenerator } from '../../support/fake/AccountFakes';
import { candidate, InMemoryMemoryRepository } from '../../support/fake/MemoryFakes';

describe('MemoryService', () => {
  const now = new Date('2026-08-06T00:00:00.000Z');

  function setup() {
    const repository = new InMemoryMemoryRepository();
    const service = new MemoryService(
      repository,
      new FixedIdGenerator([ '01MEMORY', '02MEMORY', '03MEMORY' ]),
      new FakeClock(now),
    );
    return { repository, service };
  }

  it('normalizes Unicode, punctuation, whitespace and case for stable keys', () => {
    assert.equal(normalizeMemoryKey('  Ｗeekend，  Hiking! '), 'weekend hiking');
  });

  it('keeps long-term memories and expires temporary memories after 7, 14, or 30 days', () => {
    assert.equal(expiryForMemory('profile', now), undefined);
    assert.equal(expiryForMemory('preference', now), undefined);
    assert.equal(expiryForMemory('significant_fact', now), undefined);
    assert.equal(expiryForMemory('short_term', now)?.toISOString(), '2026-08-13T00:00:00.000Z');
    assert.equal(expiryForMemory('short_term', now, 30)?.toISOString(), '2026-09-05T00:00:00.000Z');
  });

  it('lists only active, unexpired memories and formats API dates', async () => {
    const { repository, service } = setup();
    repository.items.push(
      { id: 'active', userId: 'u1', type: 'profile', content: '住在上海', summary: 'Lives in Shanghai', normalizedKey: 'city', confidence: 1, admissionScore: 7, explicitlyRequested: false, admissionReason: 'Stable profile', assessmentJson: '{}', status: 'active', createdAt: now, updatedAt: now },
      { id: 'expired', userId: 'u1', type: 'short_term', content: '这周出差', summary: 'Traveling this week', normalizedKey: 'trip', confidence: 1, admissionScore: 4, explicitlyRequested: false, admissionReason: 'Temporary', assessmentJson: '{}', status: 'active', expiresAt: new Date('2026-08-05'), createdAt: now, updatedAt: now },
      { id: 'deleted', userId: 'u1', type: 'profile', content: '旧事实', summary: 'Old fact', normalizedKey: 'old', confidence: 1, admissionScore: 6, explicitlyRequested: false, admissionReason: 'Legacy', assessmentJson: '{}', status: 'deleted', createdAt: now, updatedAt: now },
    );
    const result = await service.list('u1');
    assert.deepEqual(result.map(item => item.id), [ 'active' ]);
    assert.equal(result[0].summary, 'Lives in Shanghai');
    assert.equal(result[0].createdAt, now.toISOString());
  });

  it('corrects and soft-deletes only memories owned by the user', async () => {
    const { repository, service } = setup();
    repository.items.push({ id: 'm1', userId: 'u1', type: 'profile', content: '住在北京', summary: 'Lives in Beijing', normalizedKey: 'city', confidence: 1, admissionScore: 7, explicitlyRequested: false, admissionReason: 'Stable profile', assessmentJson: '{}', status: 'active', createdAt: now, updatedAt: now });
    const updated = await service.correct('u1', 'm1', '住在上海', 'Lives in Shanghai');
    assert.equal(updated.content, '住在上海');
    assert.equal(updated.summary, 'Lives in Shanghai');
    assert.equal(repository.items[0].normalizedKey, 'city');
    await assert.rejects(service.remove('u2', 'm1'), (error: unknown) => error instanceof AppError && error.code === 'MEMORY_NOT_FOUND');
    await service.remove('u1', 'm1');
    assert.equal(repository.items[0].status, 'deleted');
    assert.deepEqual(repository.changes.map(item => item.action), [ 'correct', 'delete' ]);
  });

  it('keeps original content, updates the summary, and does not restore from old sources', async () => {
    const { repository, service } = setup();
    await service.applyCandidates('u1', [ candidate() ]);
    await service.applyCandidates('u1', [ candidate({ sourceMessageIds: [ '02MESSAGE' ] }) ]);
    assert.equal(repository.items.length, 1);
    assert.deepEqual(repository.changes.map(item => item.action), [ 'add' ]);
    await service.applyCandidates('u1', [ candidate({
      content: '现在不再喜欢周末徒步',
      summary: 'No longer enjoys weekend hiking',
      sourceMessageIds: [ '03MESSAGE' ],
    }) ]);
    assert.equal(repository.items[0].content, '喜欢在周末徒步');
    assert.equal(repository.items[0].summary, 'No longer enjoys weekend hiking');
    await service.remove('u1', '01MEMORY');
    await service.applyCandidates('u1', [ candidate({ sourceMessageIds: [ '01MESSAGE', '02MESSAGE', '03MESSAGE' ] }) ]);
    assert.equal(repository.items.filter(item => item.status === 'active').length, 0);
    await service.applyCandidates('u1', [ candidate({
      content: '我又开始周末徒步了',
      summary: 'Enjoys weekend hiking again',
      sourceMessageIds: [ '04MESSAGE' ],
    }) ]);
    assert.equal(repository.items[0].status, 'active');
    assert.equal(repository.items[0].content, '喜欢在周末徒步');
    assert.equal(repository.items[0].summary, 'Enjoys weekend hiking again');
  });

  it('applies at most two candidates and deduplicates normalized type-key slots', async () => {
    const { repository, service } = setup();
    const changed = await service.applyCandidates('u1', [
      candidate({ normalizedKey: ' Weekend-Hiking! ', sourceMessageIds: [ 'm1' ] }),
      candidate({
        normalizedKey: 'weekend hiking', summary: 'Duplicate hiking summary',
        sourceMessageIds: [ 'm2' ],
      }),
      candidate({
        type: 'profile', normalizedKey: 'home-city', summary: 'Lives in Shanghai',
        sourceMessageIds: [ 'm3' ],
      }),
    ]);
    assert.equal(changed.length, 1);
    assert.equal(repository.items.length, 1);
    assert.equal(repository.items[0].summary, 'Enjoys weekend hiking');

    const secondBatch = await service.applyCandidates('u1', [
      candidate({
        type: 'profile', normalizedKey: 'home-city', summary: 'Lives in Shanghai',
        sourceMessageIds: [ 'm4' ],
      }),
      candidate({
        type: 'significant_fact', normalizedKey: 'graduate-goal', summary: 'Plans graduate study',
        sourceMessageIds: [ 'm5' ],
      }),
      candidate({
        type: 'profile', normalizedKey: 'occupation', summary: 'Works as a designer',
        sourceMessageIds: [ 'm6' ],
      }),
    ]);
    assert.equal(secondBatch.length, 2);
    assert.equal(repository.items.length, 3);
    assert.equal(repository.items.some(item => item.normalizedKey === 'occupation'), false);
  });

  it('caps each category and all active long-term memories deterministically', async () => {
    const repository = new InMemoryMemoryRepository();
    const ids = Array.from({ length: 40 }, (_, index) => `memory-${String(index).padStart(3, '0')}`);
    let currentTime = now;
    const service = new MemoryService(
      repository,
      new FixedIdGenerator(ids),
      { now: () => new Date(currentTime) },
    );
    const candidates = (type: 'profile' | 'preference' | 'significant_fact' | 'short_term', count: number) =>
      Array.from({ length: count }, (_, index) => candidate({
        type,
        content: `${type}-${index}`,
        summary: `${type} summary ${index}`,
        normalizedKey: `${type}-${index}`,
        ...(type === 'short_term' ? { temporaryDays: 14 as const } : {}),
        sourceMessageIds: [ `message-${type}-${index}` ],
      }));

    for (const item of [
      ...candidates('profile', 11),
      ...candidates('preference', 6),
      ...candidates('significant_fact', 11),
      ...candidates('short_term', 11),
    ]) await service.applyCandidates('u1', [ item ]);

    const activeCount = (type: string) => repository.items.filter(item =>
      item.type === type && item.status === 'active').length;
    assert.equal(activeCount('profile'), 10);
    assert.equal(activeCount('preference'), 5);
    assert.equal(activeCount('significant_fact'), 10);
    assert.equal(activeCount('short_term'), 10);
    assert.equal(repository.items.filter(item => item.status === 'active' && item.type !== 'short_term').length, 25);

    const evictedPreference = repository.items.find(item =>
      item.type === 'preference' && item.status === 'superseded');
    assert.ok(evictedPreference);
    currentTime = new Date(now.getTime() + 1_000);
    await service.applyCandidates('u1', [ candidate({
      type: 'preference',
      content: evictedPreference.content,
      normalizedKey: evictedPreference.normalizedKey,
      sourceMessageIds: [ 'message-preference-restored' ],
    }) ]);
    assert.equal(evictedPreference.status, 'active');
    assert.equal(activeCount('preference'), 5);
  });
});
