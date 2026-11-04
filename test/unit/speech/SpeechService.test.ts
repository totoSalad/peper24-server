import { strict as assert } from 'node:assert';
import { AppError } from '../../../app/module/system/error/AppError';
import { SpeechService } from '../../../app/module/speech/service/SpeechService';
import {
  FakeObjectStorage,
  FakeSpeechRecognitionProvider,
  InMemorySpeechRepository,
  SpeechFakeClock,
  SpeechFixedIdGenerator,
} from '../../support/fake/SpeechFakes';

describe('SpeechService', () => {
  const now = new Date('2026-08-06T01:00:00.000Z');

  function setup() {
    const repository = new InMemorySpeechRepository();
    const storage = new FakeObjectStorage();
    const recognition = new FakeSpeechRecognitionProvider();
    const clock = new SpeechFakeClock(now);
    const service = new SpeechService(
      repository, storage, recognition, new SpeechFixedIdGenerator([ '01RECORDING' ]), clock,
    );
    return { repository, storage, recognition, clock, service };
  }

  async function createUploadedRecording(context: ReturnType<typeof setup>) {
    const signed = await context.service.createVoiceUpload('01USER', {
      contentType: 'audio/webm;codecs=opus', sizeBytes: 1024, extension: 'webm',
    });
    const objectKey = context.storage.uploads[0].key;
    context.storage.objects.set(objectKey, {
      sizeBytes: 1024, contentType: 'audio/webm;codecs=opus',
    });
    return { ...signed, objectKey, apiResult: signed };
  }

  it('signs a private upload and retains its metadata for exactly 30 days', async () => {
    const context = setup();
    const result = await createUploadedRecording(context);

    assert.equal(result.objectKey, 'voice-recordings/01USER/2026/08/01RECORDING.webm');
    assert.equal('objectKey' in result.apiResult, false);
    assert.equal(context.repository.recordings.get(result.recordingId)?.expiresAt.toISOString(),
      '2026-09-05T01:00:00.000Z');
    assert.deepEqual(context.storage.uploads[0], {
      key: result.objectKey,
      contentType: 'audio/webm;codecs=opus',
      contentLength: 1024,
      expiresInSeconds: 300,
    });
  });

  it('returns stable validation errors for unsupported type, extension, size, and duration', async () => {
    const { service } = setup();
    const invalidUploads = [
      [{ contentType: 'audio/mpeg', sizeBytes: 10, extension: 'mp3' }, 'UNSUPPORTED_AUDIO_TYPE' ],
      [{ contentType: 'audio/mp4', sizeBytes: 10, extension: 'webm' }, 'INVALID_AUDIO_EXTENSION' ],
      [{ contentType: 'audio/mp4', sizeBytes: 10 * 1024 * 1024 + 1, extension: 'mp4' },
        'AUDIO_TOO_LARGE' ],
    ] as const;
    for (const [ input, code ] of invalidUploads) {
      await assert.rejects(service.createVoiceUpload('01USER', input),
        (error: unknown) => error instanceof AppError && error.code === code);
    }

    await assert.rejects(service.startTranscription('01USER', 'missing', 60_001),
      (error: unknown) => error instanceof AppError
        && error.code === 'INVALID_RECORDING_DURATION');
  });

  it('verifies uploaded metadata, submits ASR once, and returns the server transcript', async () => {
    const context = setup();
    const { recordingId } = await createUploadedRecording(context);

    const first = await context.service.startTranscription('01USER', recordingId, 900);
    const replay = await context.service.startTranscription('01USER', recordingId, 900);

    assert.deepEqual(first, {
      status: 'completed', recordingId, transcript: 'Hello there.', durationMs: 900,
    });
    assert.deepEqual(replay, first);
    assert.equal(context.recognition.submitCalls, 1);
    assert.match(context.recognition.submissions[0].audioUrl, /^https:\/\/download\.test\//);
  });

  it('rejects object metadata that differs from the signed upload', async () => {
    const context = setup();
    const { recordingId, objectKey } = await createUploadedRecording(context);
    context.storage.objects.set(objectKey, { sizeBytes: 512, contentType: 'audio/mp4' });

    await assert.rejects(context.service.startTranscription('01USER', recordingId, 900),
      (error: unknown) => error instanceof AppError && error.code === 'AUDIO_UPLOAD_MISMATCH');
    assert.equal(context.recognition.submitCalls, 0);
  });

  it('isolates recordings by user and maps missing and foreign ids to the same 404', async () => {
    const context = setup();
    const { recordingId } = await createUploadedRecording(context);

    for (const id of [ recordingId, 'missing' ]) {
      await assert.rejects(context.service.getTranscription('01OTHER', id),
        (error: unknown) => error instanceof AppError
          && error.code === 'VOICE_RECORDING_NOT_FOUND' && error.status === 404);
    }
  });

  it('allows a failed provider submission and an empty result to retry without duplicate claims', async () => {
    const context = setup();
    const { recordingId } = await createUploadedRecording(context);
    context.recognition.submitFailure = new Error('temporary provider failure');

    await assert.rejects(context.service.startTranscription('01USER', recordingId, 900),
      (error: unknown) => error instanceof AppError && error.code === 'SPEECH_PROVIDER_FAILED');
    assert.equal(context.repository.recordings.get(recordingId)?.status, 'failed');

    context.recognition.submitFailure = undefined;
    context.recognition.result = { status: 'completed', transcript: '   ' };
    assert.deepEqual(await context.service.startTranscription('01USER', recordingId, 900), {
      status: 'failed', errorCode: 'EMPTY_TRANSCRIPT',
    });
    assert.equal(context.recognition.submitCalls, 2);
  });

  it('uses only a completed server transcript for a voice message and binds it once', async () => {
    const context = setup();
    const { recordingId } = await createUploadedRecording(context);

    await assert.rejects(context.service.prepareVoiceMessage('01USER', recordingId),
      (error: unknown) => error instanceof AppError
        && error.code === 'TRANSCRIPTION_NOT_COMPLETED');
    await context.service.startTranscription('01USER', recordingId, 900);
    assert.deepEqual(await context.service.prepareVoiceMessage('01USER', recordingId), {
      recordingId, transcript: 'Hello there.',
    });
    await context.service.attachRecording('01USER', recordingId, '01MESSAGE');
    await context.service.attachRecording('01USER', recordingId, '01MESSAGE');
    await assert.rejects(context.service.attachRecording('01USER', recordingId, '02MESSAGE'),
      (error: unknown) => error instanceof AppError
        && error.code === 'VOICE_RECORDING_ALREADY_USED');
  });

  it('signs playback only for the owner before expiry and exposes no object key', async () => {
    const context = setup();
    const { recordingId } = await createUploadedRecording(context);
    await context.service.startTranscription('01USER', recordingId, 900);
    await context.service.attachRecording('01USER', recordingId, '01MESSAGE');

    const playback = await context.service.getMessageVoiceRecording('01USER', '01MESSAGE');
    assert.deepEqual(playback, {
      url: `https://download.test/${context.storage.uploads[0].key}`,
      expiresAt: '2026-08-06T01:10:00.000Z',
      durationMs: 900,
      contentType: 'audio/webm;codecs=opus',
    });
    await assert.rejects(context.service.getMessageVoiceRecording('01OTHER', '01MESSAGE'),
      (error: unknown) => error instanceof AppError
        && error.code === 'VOICE_RECORDING_NOT_FOUND' && error.status === 404);

    context.clock.set(new Date('2026-09-05T01:00:00.000Z'));
    await assert.rejects(context.service.getMessageVoiceRecording('01USER', '01MESSAGE'),
      (error: unknown) => error instanceof AppError
        && error.code === 'VOICE_RECORDING_EXPIRED' && error.status === 410);
  });

  it('reports available and expired voice metadata for message history', async () => {
    const context = setup();
    const { recordingId } = await createUploadedRecording(context);
    await context.service.startTranscription('01USER', recordingId, 900);
    await context.service.attachRecording('01USER', recordingId, '01MESSAGE');

    assert.deepEqual(await context.service.describeMessageRecordings('01USER', [ '01MESSAGE' ]), {
      '01MESSAGE': {
        id: recordingId, status: 'available', durationMs: 900,
        expiresAt: '2026-09-05T01:00:00.000Z',
      },
    });
    context.clock.set(new Date('2026-09-05T01:00:00.000Z'));
    assert.equal((await context.service.describeMessageRecordings('01USER', [ '01MESSAGE' ]))
      ['01MESSAGE']?.status, 'expired');
  });

  it('deletes expired objects idempotently and retries after an object-store failure', async () => {
    const context = setup();
    const { recordingId, objectKey } = await createUploadedRecording(context);
    context.clock.set(new Date('2026-09-05T01:00:00.000Z'));
    context.storage.deleteFailures.add(objectKey);

    assert.deepEqual(await context.service.expireRecordings(), { expired: 0, failed: 1 });
    assert.equal(context.repository.recordings.get(recordingId)?.deletedAt, undefined);

    context.storage.deleteFailures.clear();
    assert.deepEqual(await context.service.expireRecordings(), { expired: 1, failed: 0 });
    assert.equal(context.repository.recordings.get(recordingId)?.status, 'expired');
    assert.deepEqual(await context.service.expireRecordings(), { expired: 0, failed: 0 });
  });
});
