import { strict as assert } from 'node:assert';
import mysql from 'mysql2/promise';
import { ulid } from 'ulid';
import { DatabaseService } from '../../../app/module/infrastructure/database/DatabaseService';
import { MysqlConversationRepository } from
  '../../../app/module/infrastructure/database/MysqlConversationRepository';
import { MysqlSpeechRepository } from
  '../../../app/module/infrastructure/database/MysqlSpeechRepository';
import { SpeechService } from '../../../app/module/speech/service/SpeechService';
import { AppError } from '../../../app/module/system/error/AppError';
import {
  FakeObjectStorage,
  FakeSpeechRecognitionProvider,
  SpeechFakeClock,
  SpeechFixedIdGenerator,
} from '../../support/fake/SpeechFakes';

describe('MysqlSpeechRepository', () => {
  const now = new Date('2026-08-06T03:00:00.000Z');
  const userId = ulid();
  const conversationId = ulid();
  const messageId = ulid();
  const database = new DatabaseService();
  const repository = new MysqlSpeechRepository();
  Reflect.set(repository, 'databaseService', database);
  const speech = new SpeechService(
    repository,
    new FakeObjectStorage(),
    new FakeSpeechRecognitionProvider(),
    new SpeechFixedIdGenerator([]),
    new SpeechFakeClock(now),
  );
  const conversations = new MysqlConversationRepository();
  Reflect.set(conversations, 'databaseService', database);
  let connection: mysql.Connection;

  before(async () => {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'peper24',
      password: process.env.MYSQL_PASSWORD ?? 'peper24_dev',
      database: process.env.MYSQL_DATABASE ?? 'peper24_test',
    });
    await connection.query(`
      INSERT INTO users (id, email, password_hash, status, created_at, updated_at)
      VALUES (?, ?, 'test', 'active', ?, ?)
    `, [ userId, `speech-repository-${userId}@example.com`, now, now ]);
    await connection.query(`
      INSERT INTO conversations (
        id, user_id, topic, status, next_message_sequence, created_at, updated_at
      ) VALUES (?, ?, 'Speech integration', 'active', 2, ?, ?)
    `, [ conversationId, userId, now, now ]);
    await connection.query(`
      INSERT INTO messages (
        id, conversation_id, role, status, content, sequence, created_at, updated_at
      ) VALUES (?, ?, 'user', 'completed', 'Hello.', 1, ?, ?)
    `, [ messageId, conversationId, now, now ]);
  });

  after(async () => {
    await connection.query('DELETE FROM users WHERE id = ?', [ userId ]);
    await connection.end();
  });

  async function createCompletedRecording(transcript = 'Hello from voice.') {
    const recordingId = ulid();
    await repository.createRecording({
      id: recordingId,
      userId,
      objectKey: `voice-recordings/${userId}/2026/08/${recordingId}.webm`,
      contentType: 'audio/webm',
      sizeBytes: 1024,
      status: 'uploading',
      expiresAt: new Date('2026-09-05T03:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
    });
    await repository.claimTranscription(userId, recordingId, 1200, now, now);
    await repository.markTranscriptionSubmitted(userId, recordingId, ulid(), 1200, now);
    await repository.completeTranscription(userId, recordingId, transcript, 1200, now);
    return recordingId;
  }

  function exchangeInput(recordingId: string, clientRequestId: string) {
    const userMessageId = ulid();
    return {
      userId,
      voiceBinding: {
        recordingId,
        bindToMessage: (transaction: unknown, targetMessageId: string) => (
          speech.bindVoiceMessage(transaction, userId, recordingId, targetMessageId)
        ),
      },
      userMessage: {
        id: userMessageId,
        conversationId,
        role: 'user' as const,
        status: 'completed' as const,
        content: 'Hello from voice.',
        clientRequestId,
        createdAt: now,
        updatedAt: now,
      },
      assistantMessage: {
        id: ulid(),
        conversationId,
        replyToMessageId: userMessageId,
        role: 'assistant' as const,
        status: 'streaming' as const,
        content: '',
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  it('claims transcription once and enforces one recording per message', async () => {
    const recordingId = ulid();
    await repository.createRecording({
      id: recordingId,
      userId,
      objectKey: `voice-recordings/${userId}/2026/08/${recordingId}.webm`,
      contentType: 'audio/webm',
      sizeBytes: 1024,
      status: 'uploading',
      expiresAt: new Date('2026-09-05T03:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
    });
    const claims = await Promise.all([
      repository.claimTranscription(
        userId, recordingId, 1200, now, new Date(now.getTime() - 60_000),
      ),
      repository.claimTranscription(
        userId, recordingId, 1200, now, new Date(now.getTime() - 60_000),
      ),
    ]);
    assert.equal(claims.filter(value => value.claimed).length, 1);
    await connection.query(`
      UPDATE voice_recordings SET updated_at = ? WHERE id = ? AND user_id = ?
    `, [ new Date(now.getTime() - 120_000), recordingId, userId ]);
    const reclaimed = await repository.claimTranscription(
      userId, recordingId, 1200, now, new Date(now.getTime() - 60_000),
    );
    assert.equal(reclaimed.claimed, true);
    await repository.markTranscriptionSubmitted(userId, recordingId, 'task-1', 1200, now);
    await repository.completeTranscription(userId, recordingId, 'Hello.', 1200, now);
  });

  it('lists expired rows for object cleanup and marks them only after deletion succeeds', async () => {
    const recordingId = ulid();
    await repository.createRecording({
      id: recordingId,
      userId,
      objectKey: `voice-recordings/${userId}/2026/07/${recordingId}.mp4`,
      contentType: 'audio/mp4',
      sizeBytes: 500,
      status: 'uploading',
      expiresAt: new Date('2026-08-05T03:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
    });

    assert.ok((await repository.findExpiredRecordings(now, 100))
      .some(recording => recording.id === recordingId));
    await repository.markRecordingExpired(recordingId, now);
    assert.equal((await repository.findRecording(userId, recordingId))?.status, 'expired');
    assert.equal((await repository.findExpiredRecordings(now, 100))
      .some(recording => recording.id === recordingId), false);
  });

  it('binds through the real exchange transaction and rolls back a reused recording', async () => {
    const recordingId = await createCompletedRecording();
    const firstInput = exchangeInput(recordingId, `voice-first-${recordingId}`);
    const first = await conversations.beginExchange(firstInput);
    assert.equal(first.created, true);
    assert.equal((await repository.findRecording(userId, recordingId))?.messageId,
      firstInput.userMessage.id);

    const reusedInput = exchangeInput(recordingId, `voice-reused-${recordingId}`);
    await assert.rejects(conversations.beginExchange(reusedInput),
      (error: unknown) => error instanceof AppError
        && error.code === 'VOICE_RECORDING_ALREADY_USED');
    const [ messageRows ] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT id FROM messages WHERE conversation_id = ? AND client_request_id = ?
    `, [ conversationId, reusedInput.userMessage.clientRequestId ]);
    assert.equal(messageRows.length, 0);

    const secondRecordingId = await createCompletedRecording('A second recording.');
    const realm = await database.getRealm();
    await assert.rejects(realm.transaction(async ({ connection: transaction }) => {
      await speech.bindVoiceMessage(
        transaction, userId, secondRecordingId, firstInput.userMessage.id,
      );
    }), (error: unknown) => error instanceof AppError
      && error.code === 'VOICE_RECORDING_ALREADY_USED');
    assert.equal((await repository.findRecording(userId, secondRecordingId))?.messageId, undefined);
  });

  it('rolls back messages and sequence for unfinished and expired locked recordings', async () => {
    for (const scenario of [
      { sql: "status = 'failed'", code: 'TRANSCRIPTION_NOT_COMPLETED' },
      { sql: "expires_at = '2026-08-05 03:00:00.000'", code: 'VOICE_RECORDING_EXPIRED' },
    ]) {
      const recordingId = await createCompletedRecording();
      const prepared = await speech.prepareVoiceMessage(userId, recordingId, 900);
      await connection.query(`
        UPDATE voice_recordings SET ${scenario.sql} WHERE id = ? AND user_id = ?
      `, [ recordingId, userId ]);
      const input = exchangeInput(recordingId, `voice-rollback-${recordingId}`);
      input.userMessage.content = prepared.transcript;
      const [ beforeRows ] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT next_message_sequence FROM conversations WHERE id = ?
      `, [ conversationId ]);

      await assert.rejects(conversations.beginExchange(input),
        (error: unknown) => error instanceof AppError && error.code === scenario.code);

      const [ messageRows ] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT id FROM messages WHERE conversation_id = ? AND client_request_id = ?
      `, [ conversationId, input.userMessage.clientRequestId ]);
      const [ afterRows ] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT next_message_sequence FROM conversations WHERE id = ?
      `, [ conversationId ]);
      assert.equal(messageRows.length, 0);
      assert.equal(afterRows[0].next_message_sequence, beforeRows[0].next_message_sequence);
      assert.equal((await repository.findRecording(userId, recordingId))?.messageId, undefined);
    }
  });
});
