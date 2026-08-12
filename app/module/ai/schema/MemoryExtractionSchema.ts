import { z } from 'zod';

const score = z.union([ z.literal(0), z.literal(1), z.literal(2) ]);

const noSaveDecision = z.object({
  shouldSave: z.literal(false),
  reason: z.string().trim().min(1)
    .max(500),
}).strict();

const saveDecision = z.object({
  shouldSave: z.literal(true),
  layer: z.enum([ 'short_term', 'long_term' ]),
  type: z.enum([ 'profile', 'preference', 'significant_fact', 'short_term' ]),
  summary: z.string().trim().min(1)
    .max(500),
  normalizedKey: z.string().trim().min(1)
    .max(200),
  sourceMessageIds: z.array(z.string().trim().min(1)
    .max(64)).min(1).max(20),
  scores: z.object({
    stability: score,
    futureValue: score,
    personalImportance: score,
    explicitness: score,
  }).strict(),
  penalties: z.array(z.enum([ 'current_context_only', 'too_granular', 'one_off_event' ]))
    .max(3),
  explicitRemember: z.boolean(),
  inferredOrHypothetical: z.boolean(),
  containsSecret: z.boolean(),
  temporaryDays: z.union([ z.literal(7), z.literal(14), z.literal(30) ]).optional(),
  reason: z.string().trim().min(1)
    .max(500),
}).strict();

export const MemoryExtractionSchema = z.object({
  decisions: z.union([
    z.tuple([ noSaveDecision ]),
    z.array(saveDecision).min(1).max(2),
  ]),
}).strict();
