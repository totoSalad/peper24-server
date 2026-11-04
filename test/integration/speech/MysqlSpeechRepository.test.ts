import { strict as assert } from 'node:assert';
import mysql from 'mysql2/promise';
import { ulid } from 'ulid';
import { DatabaseService } from '../../../app/module/infrastructure/database/DatabaseService';
import { MysqlSpeechRepository } from
  '../../../app/module/infrastructure/database/MysqlSpeechRepository';

describe('MysqlSpeechRepository', () => {
  const now = new Date('2026-08-06T03:00:00.000Z');
  const userId = ulid();
  const conversationId = ulid();
  const messageId = ulid();
  const database = new DatabaseService();
  const repository = new MysqlSpeechRepository();
  Reflect.set(repository, 'databaseService', database);
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
      repository.claimTranscription(userId, recordingId, 1200, now),
      repository.claimTranscription(userId, recordingId, 1200, now),
    ]);
    assert.equal(claims.filter(value => value.claimed).length, 1);
    await repository.markTranscriptionSubmitted(userId, recordingId, 'task-1', 1200, now);
    await repository.completeTranscription(userId, recordingId, 'Hello.', 1200, now);
    assert.equal(await repository.attachRecording(userId, recordingId, messageId, now), true);
    assert.equal((await repository.findRecordingByMessage(userId, messageId))?.id, recordingId);
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
});
