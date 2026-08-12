import { strict as assert } from 'node:assert';
import { MemoryExtractionService } from '../../../app/module/memory/service/MemoryExtractionService';
import { MemoryService } from '../../../app/module/memory/service/MemoryService';
import { FakeClock, FixedIdGenerator } from '../../support/fake/AccountFakes';
import { FakeProductAIService } from '../../support/fake/ConversationFakes';
import { InMemoryMemoryRepository } from '../../support/fake/MemoryFakes';

describe('MemoryExtractionService', () => {
  const now = new Date('2026-08-11T00:00:00.000Z');

  function setup(messageCount: number) {
    const repository = new InMemoryMemoryRepository();
    repository.unscannedMessages = Array.from({ length: messageCount }, (_, index) => ({
      id: `u${index + 1}`, conversationId: 'c1', userId: 'user-1', role: 'user' as const,
      content: `message ${index + 1}`, sequence: index * 2 + 1, createdAt: new Date(now.getTime() + index),
    }));
    repository.extractionMessages = [ ...repository.unscannedMessages ];
    const ai = new FakeProductAIService();
    const memory = new MemoryService(repository, new FixedIdGenerator([ 'm1', 'm2' ]), new FakeClock(now));
    return { repository, ai, extraction: new MemoryExtractionService(repository, memory, ai, new FakeClock(now)) };
  }

  it('does not call AI or scan messages when a conversation has fewer than ten targets', async () => {
    const { repository, ai, extraction } = setup(9);
    assert.deepEqual(await extraction.processPendingForUser('user-1'), []);
    assert.equal(ai.memoryExtractionCalls, 0);
    assert.equal(repository.scannedMessageIds.length, 0);
  });

  it('calls AI once for ten to twenty targets and scans them when nothing should be saved', async () => {
    const { repository, ai, extraction } = setup(20);
    ai.memoryExtraction = { decisions: [{ shouldSave: false, reason: 'Current conversation details only' }] };
    assert.deepEqual(await extraction.processPendingForUser('user-1'), []);
    assert.equal(ai.memoryExtractionCalls, 1);
    assert.equal(ai.memoryExtractionInputs[0].targetMessageIds.length, 20);
    assert.equal(repository.scannedMessageIds.length, 20);
  });

  it('processes only the earliest twenty targets and leaves overflow pending', async () => {
    const { repository, ai, extraction } = setup(21);
    ai.memoryExtraction = { decisions: [{ shouldSave: false, reason: 'Nothing durable' }] };
    await extraction.processPendingForUser('user-1');
    assert.deepEqual(ai.memoryExtractionInputs[0].targetMessageIds, Array.from({ length: 20 }, (_, i) => `u${i + 1}`));
    assert.deepEqual(repository.unscannedMessages.map(item => item.id), [ 'u21' ]);
  });

  it('processes thirty-five targets as twenty followed by fifteen in separate runs', async () => {
    const { repository, ai, extraction } = setup(35);
    ai.memoryExtraction = { decisions: [{ shouldSave: false, reason: 'Nothing durable' }] };
    await extraction.processPendingForUser('user-1');
    assert.equal(repository.unscannedMessages.length, 15);
    await extraction.processPendingForUser('user-1');
    assert.equal(ai.memoryExtractionCalls, 2);
    assert.equal(ai.memoryExtractionInputs[0].targetMessageIds.length, 20);
    assert.equal(ai.memoryExtractionInputs[1].targetMessageIds.length, 15);
    assert.equal(repository.unscannedMessages.length, 0);
  });

  it('counts each user and conversation separately and skips ineligible groups', async () => {
    const { repository, ai, extraction } = setup(0);
    const makeMessages = (userId: string, conversationId: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `${userId}-${conversationId}-${index}`, userId, conversationId, role: 'user' as const,
        content: 'detail', sequence: index + 1, createdAt: new Date(now.getTime() + index),
      }));
    repository.unscannedMessages = [
      ...makeMessages('u1', 'c1', 9),
      ...makeMessages('u1', 'c2', 5),
      ...makeMessages('u2', 'c2', 5),
      ...makeMessages('u2', 'c3', 10),
    ];
    repository.extractionMessages = [ ...repository.unscannedMessages ];
    ai.memoryExtraction = { decisions: [{ shouldSave: false, reason: 'Nothing durable' }] };
    await extraction.processPendingForUser('u2');
    assert.equal(ai.memoryExtractionCalls, 1);
    assert.equal(ai.memoryExtractionInputs[0].targetMessageIds.length, 10);
    assert.ok(ai.memoryExtractionInputs[0].targetMessageIds.every(id => id.startsWith('u2-')));
    assert.equal(repository.unscannedMessages.length, 19);
  });

  it('persists up to two admitted decisions using each source message content', async () => {
    const { repository, ai, extraction } = setup(10);
    ai.memoryExtraction = { decisions: [{
      shouldSave: true,
      layer: 'long_term',
      type: 'profile',
      summary: 'Lives in Shanghai',
      normalizedKey: 'home-city',
      sourceMessageIds: [ 'u3' ],
      scores: { stability: 2, futureValue: 2, personalImportance: 1, explicitness: 2 },
      penalties: [],
      explicitRemember: false,
      inferredOrHypothetical: false,
      containsSecret: false,
      reason: 'Stable profile detail',
    }, {
      shouldSave: true,
      layer: 'long_term',
      type: 'preference',
      summary: 'Treats cooking as a main hobby',
      normalizedKey: 'cooking-hobby',
      sourceMessageIds: [ 'u5' ],
      scores: { stability: 2, futureValue: 2, personalImportance: 1, explicitness: 2 },
      penalties: [],
      explicitRemember: false,
      inferredOrHypothetical: false,
      containsSecret: false,
      reason: 'Stable hobby',
    }] };
    const changed = await extraction.processPendingForUser('user-1');
    assert.equal(changed.length, 2);
    assert.equal(changed[0].content, 'message 3');
    assert.equal(changed[0].summary, 'Lives in Shanghai');
    assert.equal(changed[1].content, 'message 5');
    assert.equal(repository.items.length, 2);
  });

  it('keeps the valid decision when the second decision fails admission', async () => {
    const { repository, ai, extraction } = setup(10);
    ai.memoryExtraction = { decisions: [{
      shouldSave: true, layer: 'long_term', type: 'profile', summary: 'Lives in Shanghai',
      normalizedKey: 'home-city', sourceMessageIds: [ 'u1' ],
      scores: { stability: 2, futureValue: 2, personalImportance: 1, explicitness: 2 },
      penalties: [], explicitRemember: false, inferredOrHypothetical: false,
      containsSecret: false, reason: 'Stable profile',
    }, {
      shouldSave: true, layer: 'long_term', type: 'preference', summary: 'Likes fried eggs',
      normalizedKey: 'fried-eggs', sourceMessageIds: [ 'u2' ],
      scores: { stability: 1, futureValue: 0, personalImportance: 0, explicitness: 2 },
      penalties: [ 'too_granular' ], explicitRemember: false, inferredOrHypothetical: false,
      containsSecret: false, reason: 'Ordinary food detail',
    }] };
    const changed = await extraction.processPendingForUser('user-1');
    assert.equal(changed.length, 1);
    assert.equal(repository.items[0].normalizedKey, 'home city');
    assert.equal(repository.scannedMessageIds.length, 10);
  });

  it('leaves targets unscanned when extraction fails so the next schedule can retry', async () => {
    const { repository, ai, extraction } = setup(10);
    ai.memoryExtractionFailure = new Error('provider unavailable');
    await assert.rejects(extraction.processPendingForUser('user-1'), /provider unavailable/);
    assert.deepEqual(repository.scannedMessageIds, []);
    assert.equal(repository.unscannedMessages.length, 10);
  });

  it('leaves targets unscanned when persistence fails', async () => {
    const { repository, ai, extraction } = setup(10);
    ai.memoryExtraction = { decisions: [{
      shouldSave: true, layer: 'long_term', type: 'profile', summary: 'Lives in Shanghai',
      normalizedKey: 'home-city', sourceMessageIds: [ 'u1' ],
      scores: { stability: 2, futureValue: 2, personalImportance: 1, explicitness: 2 },
      penalties: [], explicitRemember: false, inferredOrHypothetical: false,
      containsSecret: false, reason: 'Stable profile',
    }] };
    repository.applyCandidates = async () => {
      throw new Error('database unavailable');
    };
    await assert.rejects(extraction.processPendingForUser('user-1'), /database unavailable/);
    assert.deepEqual(repository.scannedMessageIds, []);
    assert.equal(repository.unscannedMessages.length, 10);
  });
});
