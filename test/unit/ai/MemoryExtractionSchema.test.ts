import { strict as assert } from 'node:assert';
import { MemoryExtractionSchema } from '../../../app/module/ai/schema/MemoryExtractionSchema';

describe('MemoryExtractionSchema', () => {
  const savedDecision = {
    shouldSave: true as const,
    layer: 'long_term' as const,
    type: 'profile' as const,
    summary: 'Lives in Shanghai',
    normalizedKey: 'home-city',
    sourceMessageIds: [ 'u1' ],
    scores: {
      futureValue: 2 as const,
      personalImportance: 1 as const,
      explicitness: 2 as const,
    },
    penalties: [],
    explicitRemember: false,
    inferredOrHypothetical: false,
    containsSecret: false,
    reason: 'Stable profile',
  };

  it('accepts one no-save decision or one to two save decisions', () => {
    assert.equal(MemoryExtractionSchema.safeParse({
      decisions: [{ shouldSave: false, reason: 'Nothing durable' }],
    }).success, true);
    assert.equal(MemoryExtractionSchema.safeParse({
      decisions: [
        savedDecision,
        { ...savedDecision, type: 'preference', normalizedKey: 'hiking' },
      ],
    }).success, true);
  });

  it('rejects empty, mixed, or more than two decisions', () => {
    assert.equal(MemoryExtractionSchema.safeParse({ decisions: [] }).success, false);
    assert.equal(MemoryExtractionSchema.safeParse({
      decisions: [{ shouldSave: false, reason: 'No' }, savedDecision ],
    }).success, false);
    assert.equal(MemoryExtractionSchema.safeParse({
      decisions: [ savedDecision, savedDecision, savedDecision ],
    }).success, false);
  });

  it('rejects the removed stability score', () => {
    assert.equal(MemoryExtractionSchema.safeParse({
      decisions: [{
        ...savedDecision,
        scores: { ...savedDecision.scores, stability: 2 },
      }],
    }).success, false);
  });
});
