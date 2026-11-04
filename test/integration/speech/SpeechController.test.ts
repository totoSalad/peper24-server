import { strict as assert } from 'node:assert';
import { app } from '@eggjs/mock/bootstrap';
import mysql from 'mysql2/promise';
import { ulid } from 'ulid';

describe('SpeechController', () => {
  const originalOss = {
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket: process.env.OSS_BUCKET,
    region: process.env.OSS_REGION,
  };
  let cookie: string;
  let userId: string;

  before(async () => {
    process.env.OSS_ACCESS_KEY_ID = 'test-access-key-id';
    process.env.OSS_ACCESS_KEY_SECRET = 'test-access-key-secret';
    process.env.OSS_BUCKET = 'peper24-test';
    process.env.OSS_REGION = 'oss-cn-beijing';
    const registration = await app.httpRequest().post('/api/v1/auth/register')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .send({
        email: `speech-http-${Date.now()}@example.com`,
        password: 'integration-password',
        profile: { displayName: '语音测试', englishLevel: 'B1' },
      })
      .expect(201);
    const setCookie = registration.headers['set-cookie'];
    assert.ok(setCookie);
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
    userId = registration.body.data.user.id;
  });

  after(() => {
    for (const [ key, value ] of Object.entries({
      OSS_ACCESS_KEY_ID: originalOss.accessKeyId,
      OSS_ACCESS_KEY_SECRET: originalOss.accessKeySecret,
      OSS_BUCKET: originalOss.bucket,
      OSS_REGION: originalOss.region,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function insertRecording(input: {
    id: string;
    status: string;
    expiresAt: Date;
    transcript?: string;
    messageId?: string;
    updatedAt?: Date;
  }) {
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'peper24',
      password: process.env.MYSQL_PASSWORD ?? 'peper24_dev',
      database: process.env.MYSQL_DATABASE ?? 'peper24_test',
    });
    const now = new Date();
    try {
      await connection.query(`
        INSERT INTO voice_recordings (
          id, user_id, message_id, oss_key, content_type, size_bytes, duration_ms, status,
          transcript, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'audio/webm', 1024, 900, ?, ?, ?, ?, ?)
      `, [
        input.id,
        userId,
        input.messageId ?? null,
        `voice-recordings/${userId}/${input.id}.webm`,
        input.status,
        input.transcript ?? null,
        input.expiresAt,
        now,
        input.updatedAt ?? now,
      ]);
    } finally {
      await connection.end();
    }
  }

  it('signs an authenticated browser upload without leaking the private object key', async () => {
    const response = await app.httpRequest().post('/api/v1/uploads/sign')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({
        purpose: 'voice_recording',
        contentType: 'audio/webm;codecs=opus',
        sizeBytes: 1024,
        extension: 'webm',
      })
      .expect(201);

    assert.match(response.body.data.recordingId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.match(response.body.data.uploadUrl, /^https:\/\//);
    assert.equal(response.body.data.headers['Content-Type'], 'audio/webm;codecs=opus');
    assert.equal(response.body.data.objectKey, undefined);
  });

  it('enforces authentication, Origin, strict schema, and upload limits', async () => {
    const valid = {
      purpose: 'voice_recording', contentType: 'audio/mp4', sizeBytes: 100, extension: 'mp4',
    };
    await app.httpRequest().post('/api/v1/uploads/sign')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .send(valid)
      .expect(401);
    await app.httpRequest().post('/api/v1/uploads/sign')
      .set('Host', 'localhost')
      .set('Origin', 'https://attacker.example')
      .set('Cookie', cookie)
      .send(valid)
      .expect(403);
    for (const body of [
      { ...valid, sizeBytes: 10 * 1024 * 1024 + 1 },
      { ...valid, purpose: 'avatar' },
      { ...valid, unexpected: true },
    ]) {
      await app.httpRequest().post('/api/v1/uploads/sign')
        .set('Host', 'localhost')
        .set('Origin', 'http://localhost')
        .set('Cookie', cookie)
        .send(body)
        .expect(400);
    }
  });

  it('returns the same 404 contract for missing recordings and message audio', async () => {
    const transcription = await app.httpRequest()
      .get('/api/v1/speech/transcriptions/01MISSING')
      .set('Cookie', cookie)
      .expect(404);
    assert.equal(transcription.body.error.code, 'VOICE_RECORDING_NOT_FOUND');

    const playback = await app.httpRequest()
      .get('/api/v1/messages/01MISSING/voice-recording')
      .set('Cookie', cookie)
      .expect(404);
    assert.equal(playback.body.error.code, 'VOICE_RECORDING_NOT_FOUND');
  });

  it('returns 202 while processing, 409 before transcription, and 410 for expired playback', async () => {
    const creation = await app.httpRequest()
      .post('/api/v1/conversations')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ topic: 'restaurant' })
      .expect(201);
    const conversationId = creation.body.data.conversation.id as string;
    const expiredMessageId = ulid();
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'peper24',
      password: process.env.MYSQL_PASSWORD ?? 'peper24_dev',
      database: process.env.MYSQL_DATABASE ?? 'peper24_test',
    });
    try {
      await connection.query(`
        INSERT INTO messages (
          id, conversation_id, role, status, content, sequence, created_at, updated_at
        ) VALUES (?, ?, 'user', 'completed', 'Expired voice.', 2, ?, ?)
      `, [ expiredMessageId, conversationId, new Date(), new Date() ]);
    } finally {
      await connection.end();
    }
    const processingId = ulid();
    const unstartedId = ulid();
    const expiredId = ulid();
    await insertRecording({
      id: processingId,
      status: 'submitting',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await insertRecording({
      id: unstartedId,
      status: 'uploading',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await insertRecording({
      id: expiredId,
      status: 'completed',
      transcript: 'Expired voice.',
      messageId: expiredMessageId,
      expiresAt: new Date(Date.now() - 1),
    });

    const processing = await app.httpRequest()
      .get(`/api/v1/speech/transcriptions/${processingId}`)
      .set('Cookie', cookie)
      .expect(202);
    assert.equal(processing.body.data.status, 'processing');

    const unstarted = await app.httpRequest()
      .get(`/api/v1/speech/transcriptions/${unstartedId}`)
      .set('Cookie', cookie)
      .expect(409);
    assert.equal(unstarted.body.error.code, 'TRANSCRIPTION_NOT_STARTED');

    const expired = await app.httpRequest()
      .get(`/api/v1/messages/${expiredMessageId}/voice-recording`)
      .set('Cookie', cookie)
      .expect(410);
    assert.equal(expired.body.error.code, 'VOICE_RECORDING_EXPIRED');
  });

  it('sends the persisted transcript and returns playable voice metadata in message history', async () => {
    const creation = await app.httpRequest()
      .post('/api/v1/conversations')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ topic: 'restaurant' })
      .expect(201);
    const conversationId = creation.body.data.conversation.id as string;
    const recordingId = ulid();
    const objectKey = `voice-recordings/${userId}/2026/08/${recordingId}.webm`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'peper24',
      password: process.env.MYSQL_PASSWORD ?? 'peper24_dev',
      database: process.env.MYSQL_DATABASE ?? 'peper24_test',
    });
    try {
      await connection.query(`
        INSERT INTO voice_recordings (
          id, user_id, oss_key, content_type, size_bytes, duration_ms, status, transcript,
          expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'audio/webm', 1024, 900, 'completed', 'Server transcript.', ?, ?, ?)
      `, [ recordingId, userId, objectKey, expiresAt, now, now ]);
    } finally {
      await connection.end();
    }

    await app.httpRequest()
      .post(`/api/v1/conversations/${conversationId}/messages/stream`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ voiceRecordingId: recordingId, clientRequestId: 'voice-http-1' })
      .expect(200);

    const reused = await app.httpRequest()
      .post(`/api/v1/conversations/${conversationId}/messages/stream`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ voiceRecordingId: recordingId, clientRequestId: 'voice-http-2' })
      .expect(200);
    assert.match(reused.text, /VOICE_RECORDING_ALREADY_USED/);

    const history = await app.httpRequest()
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('Cookie', cookie)
      .expect(200);
    const voiceMessage = history.body.data.messages.find(
      (message: { clientRequestId?: string }) => message.clientRequestId === 'voice-http-1',
    );
    assert.equal(voiceMessage.content, 'Server transcript.');
    assert.equal(voiceMessage.voiceRecording.status, 'available');
    assert.equal(voiceMessage.voiceRecording.id, recordingId);

    const playback = await app.httpRequest()
      .get(`/api/v1/messages/${voiceMessage.id}/voice-recording`)
      .set('Cookie', cookie)
      .expect(200);
    assert.match(playback.body.data.url, /^https:\/\//);
    assert.equal(playback.body.data.objectKey, undefined);
  });
});
