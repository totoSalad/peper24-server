import { z } from 'zod';

export const CreateConversationSchema = z.object({
  topic: z.string().trim().min(1)
    .max(120),
});

export const StreamMessageSchema = z.object({
  content: z.string().trim().min(1)
    .max(4000),
  clientRequestId: z.string().trim().min(1)
    .max(128),
});
