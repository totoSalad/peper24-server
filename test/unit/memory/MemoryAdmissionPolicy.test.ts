import { strict as assert } from 'node:assert';
import { admitMemoryDecision } from '../../../app/module/memory/service/MemoryAdmissionPolicy';
import type { MemorySourceMessage } from '../../../app/module/memory/service/MemoryPorts';

describe('MemoryAdmissionPolicy', () => {
  const now = new Date('2026-08-11T00:00:00.000Z');
  const sources: MemorySourceMessage[] = [
    { id: 'u1', conversationId: 'c1', userId: 'user-1', role: 'user', content: 'Cooking is my main hobby.', sequence: 1, createdAt: now },
    { id: 'u2', conversationId: 'c1', userId: 'user-1', role: 'user', content: 'I cook almost every day.', sequence: 3, createdAt: now },
  ];

  it('accepts one grounded high-value decision and takes content from the earliest source', () => {
    const candidate = admitMemoryDecision({
      shouldSave: true,
      layer: 'long_term',
      type: 'preference',
      summary: 'Treats cooking as a main hobby and cooks almost every day',
      normalizedKey: 'cooking-hobby',
      sourceMessageIds: [ 'u2', 'u1' ],
      scores: { futureValue: 2, personalImportance: 1, explicitness: 2 },
      penalties: [],
      explicitRemember: false,
      inferredOrHypothetical: false,
      containsSecret: false,
      reason: 'Stable hobby with cross-context value',
    }, sources, new Set([ 'u1', 'u2' ]));

    assert.equal(candidate?.content, 'Cooking is my main hobby.');
    assert.equal(candidate?.admissionScore, 5);
  });

  it('uses four as the long-term admission threshold without a stability score', () => {
    const base = {
      shouldSave: true as const,
      layer: 'long_term' as const,
      type: 'preference' as const,
      summary: 'Enjoys cooking',
      normalizedKey: 'cooking-hobby',
      sourceMessageIds: [ 'u1' ],
      scores: { futureValue: 1 as const, personalImportance: 1 as const, explicitness: 2 as const },
      penalties: [],
      explicitRemember: false,
      inferredOrHypothetical: false,
      containsSecret: false,
      reason: 'Useful personal preference',
    };
    assert.equal(admitMemoryDecision(base, sources, new Set([ 'u1' ]))?.admissionScore, 4);
    const legacyDecision = {
      ...base,
      scores: { ...base.scores, stability: 2 },
    };
    assert.equal(admitMemoryDecision(legacyDecision, sources, new Set([ 'u1' ]))?.admissionScore, 4);
    assert.equal(admitMemoryDecision({
      ...base,
      scores: { ...base.scores, personalImportance: 0 },
    }, sources, new Set([ 'u1' ])), null);
  });

  it('rejects low-value, inferred, secret, and ungrounded decisions', () => {
    const base = {
      shouldSave: true as const,
      layer: 'long_term' as const,
      type: 'preference' as const,
      summary: 'Likes fried eggs',
      normalizedKey: 'fried-eggs',
      sourceMessageIds: [ 'u1' ],
      scores: { futureValue: 0 as const, personalImportance: 0 as const, explicitness: 2 as const },
      penalties: [ 'too_granular' as const ],
      explicitRemember: false,
      inferredOrHypothetical: false,
      containsSecret: false,
      reason: 'Food detail',
    };
    assert.equal(admitMemoryDecision(base, sources, new Set([ 'u1' ])), null);
    assert.equal(admitMemoryDecision({ ...base, explicitRemember: true, containsSecret: true }, sources, new Set([ 'u1' ])), null);
    assert.equal(admitMemoryDecision({ ...base, explicitRemember: true, inferredOrHypothetical: true }, sources, new Set([ 'u1' ])), null);
    assert.equal(admitMemoryDecision({ ...base, explicitRemember: true, sourceMessageIds: [ 'missing' ] }, sources, new Set([ 'u1' ])), null);
  });

  it('rejects secrets detected in source text and temporary memories without an allowed TTL', () => {
    const secretSource = [{ ...sources[0], content: 'Remember my API token is abc123.' }];
    const explicit = {
      shouldSave: true as const,
      layer: 'long_term' as const,
      type: 'profile' as const,
      summary: 'API token', normalizedKey: 'api-token', sourceMessageIds: [ 'u1' ],
      scores: { futureValue: 0 as const, personalImportance: 0 as const, explicitness: 2 as const },
      penalties: [], explicitRemember: true, inferredOrHypothetical: false,
      containsSecret: false, reason: 'Explicit request',
    };
    assert.equal(admitMemoryDecision(explicit, secretSource, new Set([ 'u1' ])), null);
    assert.equal(admitMemoryDecision({
      ...explicit, layer: 'short_term', type: 'short_term', summary: 'Busy this week',
      normalizedKey: 'busy-this-week',
    }, sources, new Set([ 'u1' ])), null);
  });

  it('lets an explicit non-secret remember request bypass the score threshold', () => {
    const candidate = admitMemoryDecision({
      shouldSave: true,
      layer: 'long_term',
      type: 'profile',
      summary: 'Has a peanut allergy',
      normalizedKey: 'peanut-allergy',
      sourceMessageIds: [ 'u1' ],
      scores: { futureValue: 0, personalImportance: 0, explicitness: 2 },
      penalties: [ 'one_off_event' ],
      explicitRemember: true,
      inferredOrHypothetical: false,
      containsSecret: false,
      reason: 'Explicit request',
    }, sources, new Set([ 'u1' ]));
    assert.equal(candidate?.explicitlyRequested, true);
  });
});
