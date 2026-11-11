import { z } from 'zod';

export const SignVoiceUploadSchema = z.object({
  purpose: z.literal('voice_recording'),
  contentType: z.enum([ 'audio/webm', 'audio/webm;codecs=opus', 'audio/mp4' ]),
  sizeBytes: z.number().int().min(1)
    .max(10 * 1024 * 1024),
  extension: z.enum([ 'webm', 'mp4' ]),
}).strict();

export const StartTranscriptionSchema = z.object({
  recordingId: z.string().trim().min(1)
    .max(128),
  durationMs: z.number().int().min(1)
    .max(60_000),
}).strict();

export const RecordingIdSchema = z.string().trim().min(1)
  .max(128);
export const MessageIdSchema = z.string().trim().min(1)
  .max(128);
