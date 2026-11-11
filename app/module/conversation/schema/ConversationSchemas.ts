import { z } from 'zod';

export const CreateConversationSchema = z.object({
  topic: z.string().trim().min(1)
    .max(120),
});

const ClientRequestSchema = z.string().trim().min(1)
  .max(128);

export const StreamMessageSchema = z.union([ z.object({
  content: z.string().trim().min(1)
    .max(4000),
  clientRequestId: ClientRequestSchema,
}).strict(), z.object({
  voiceRecordingId: z.string().trim().min(1)
    .max(128),
  durationMs: z.number().int().min(1)
    .max(60_000),
  clientRequestId: ClientRequestSchema,
}).strict() ]);
