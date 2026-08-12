import { strict as assert } from 'node:assert';
import mysql from 'mysql2/promise';
import { ulid } from 'ulid';
import { DatabaseService } from '../../../app/module/infrastructure/database/DatabaseService';
import { MysqlMemoryRepository } from '../../../app/module/infrastructure/database/MysqlMemoryRepository';
import type { MemoryCandidate, MemoryRecord } from '../../../app/module/memory/service/MemoryPorts';

describe('MysqlMemoryRepository', () => {
  const now = new Date('2026-08-06T04:00:00.000Z');
  const userId = ulid();
  const conversationId = ulid();
  const oldMessageId = ulid();
  const assistantMessageId = ulid();
  const newMessageId = ulid();
  const database = new DatabaseService();
  const repository = new MysqlMemoryRepository();
  Reflect.set(repository, 'databaseService', database);
  let connection: mysql.Connection;

  before(async () => {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST ?? '127.0.0.1', port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'peper24', password: process.env.MYSQL_PASSWORD ?? 'peper24_dev',
      database: process.env.MYSQL_DATABASE ?? 'peper24_test',
    });
    await connection.query(`
      INSERT INTO users (id, email, password_hash, status, created_at, updated_at)
      VALUES (?, ?, 'test', 'active', ?, ?)
    `, [ userId, `memory-repository-${userId}@example.com`, now, now ]);
    await connection.query(`
      INSERT INTO conversations (
        id, user_id, topic, status, next_message_sequence, created_at, updated_at
      ) VALUES (?, ?, 'Memory integration', 'active', 4, ?, ?)
    `, [ conversationId, userId, now, now ]);
    await connection.query(`
      INSERT INTO messages (
        id, conversation_id, role, status, content, memory_scanned_at,
        sequence, created_at, updated_at
      ) VALUES (?, ?, 'user', 'completed', 'I live in Shanghai.', ?, 1, ?, ?),
               (?, ?, 'assistant', 'completed', 'Where do you live now?', NULL, 2, ?, ?),
               (?, ?, 'user', 'completed', 'I moved to Hangzhou.', NULL, 3, ?, ?)
    `, [
      oldMessageId, conversationId, now, now, now,
      assistantMessageId, conversationId, now, now,
      newMessageId, conversationId, now, now,
    ]);
  });

  after(async () => {
    await connection.query('DELETE FROM users WHERE id = ?', [ userId ]);
    await connection.end();
  });

  function input(candidate: MemoryCandidate, id: string) {
    return {
      userId, candidates: [ candidate ], now,
      expiryFor: () => undefined,
      limitFor: () => undefined,
      longTermLimit: 25,
      create: (): MemoryRecord => ({
        id, userId, type: candidate.type, content: candidate.content,
        summary: candidate.summary,
        normalizedKey: candidate.normalizedKey, confidence: candidate.confidence,
        admissionScore: candidate.admissionScore,
        explicitlyRequested: candidate.explicitlyRequested,
        admissionReason: candidate.admissionReason,
        assessmentJson: candidate.assessmentJson,
        status: 'active', createdAt: now, updatedAt: now,
      }),
    };
  }

  it('loads unscanned user targets with surrounding context and marks only targets scanned', async () => {
    const groups = await repository.loadPendingMemoryGroups({
      userId,
      minimumMessages: 1, maximumMessagesPerGroup: 20, maximumGroups: 20,
    });
    const targets = groups.find(item => item.conversationId === conversationId)?.targetMessages ?? [];
    assert.deepEqual(targets.map(item => item.id), [ newMessageId ]);

    const context = await repository.loadExtractionContext(conversationId, userId, targets);
    assert.deepEqual(context.map(item => item.id), [
      oldMessageId, assistantMessageId, newMessageId,
    ]);

    await repository.markMessagesScanned(userId, [ newMessageId ], new Date(now.getTime() + 3_000));
    const remaining = await repository.loadPendingMemoryGroups({
      userId,
      minimumMessages: 1, maximumMessagesPerGroup: 20, maximumGroups: 20,
    });
    assert.equal(remaining.some(group => group.targetMessages.some(item => item.id === newMessageId)), false);
    const [ rows ] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT id, memory_scanned_at FROM messages WHERE id IN (?, ?) ORDER BY id',
      [ assistantMessageId, newMessageId ],
    );
    assert.equal(rows.find(row => row.id === assistantMessageId)?.memory_scanned_at, null);
    assert.ok(rows.find(row => row.id === newMessageId)?.memory_scanned_at);
  });

  it('requires ten messages per conversation and returns only the earliest twenty', async () => {
    const smallConversationId = ulid();
    const largeConversationId = ulid();
    await connection.query(`
      INSERT INTO conversations (
        id, user_id, topic, status, next_message_sequence, created_at, updated_at
      ) VALUES (?, ?, 'Small pending group', 'active', 10, ?, ?),
               (?, ?, 'Large pending group', 'active', 22, ?, ?)
    `, [ smallConversationId, userId, now, now, largeConversationId, userId, now, now ]);
    const insertMessages = async (conversation: string, count: number, prefix: string) => {
      for (let index = 0; index < count; index++) {
        await connection.query(`
          INSERT INTO messages (
            id, conversation_id, role, status, content, memory_scanned_at,
            sequence, created_at, updated_at
          ) VALUES (?, ?, 'user', 'completed', ?, NULL, ?, ?, ?)
        `, [ ulid(), conversation, `${prefix}-${index + 1}`, index + 1,
          new Date(now.getTime() + index), now ]);
      }
    };
    await insertMessages(smallConversationId, 9, 'small');
    await insertMessages(largeConversationId, 21, 'large');

    const groups = await repository.loadPendingMemoryGroups({
      userId,
      minimumMessages: 10, maximumMessagesPerGroup: 20, maximumGroups: 20,
    });
    assert.equal(groups.some(group => group.conversationId === smallConversationId), false);
    const large = groups.find(group => group.conversationId === largeConversationId);
    assert.equal(large?.targetMessages.length, 20);
    assert.deepEqual(large?.targetMessages.map(item => item.content),
      Array.from({ length: 20 }, (_, index) => `large-${index + 1}`));
  });

  it('deduplicates concurrent inserts and blocks deleted memories from old sources only', async () => {
    const candidate: MemoryCandidate = {
      type: 'profile', content: '我住在上海。', summary: 'Lives in Shanghai',
      normalizedKey: 'home city', confidence: 0.95,
      admissionScore: 7, explicitlyRequested: false,
      admissionReason: 'Stable profile', assessmentJson: '{}',
      sourceMessageIds: [ oldMessageId ],
    };
    const results = await Promise.all([
      repository.applyCandidates(input(candidate, ulid())),
      repository.applyCandidates(input(candidate, ulid())),
    ]);
    assert.equal(results.flat().length, 1);
    const current = await repository.list(userId, new Date('2026-08-06T04:01:00.000Z'));
    assert.equal(current.length, 1);
    await repository.delete(userId, current[0].id, now);
    assert.deepEqual(await repository.applyCandidates(input(candidate, ulid())), []);

    const moved = {
      ...candidate,
      content: '我搬到杭州了。',
      summary: 'Lives in Hangzhou',
      sourceMessageIds: [ newMessageId ],
    };
    const reactivated = await repository.applyCandidates(input(moved, ulid()));
    assert.equal(reactivated[0].id, current[0].id);
    assert.equal(reactivated[0].content, '我住在上海。');
    assert.equal(reactivated[0].summary, 'Lives in Hangzhou');
  });

  it('keeps only the five highest-priority active preferences', async () => {
    const seedAt = new Date(now.getTime() + 5_000);
    const seedValues: Array<string | number | Date> = [];
    const seedRows = Array.from({ length: 5 }, (_, index) => {
      seedValues.push(
        ulid(), userId, `强烈喜好 ${index}`, `Strong preference ${index}`,
        `preference ${String(index).padStart(2, '0')}`,
        0.95, 6, 0, 'Seed preference', '{}', seedAt, seedAt,
      );
      return "(?, ?, 'preference', ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)";
    });
    await connection.query(`
      INSERT INTO memories (
        id, user_id, type, content, summary, normalized_key, confidence,
        admission_score, explicitly_requested, admission_reason, assessment_json, status,
        expires_at, created_at, updated_at
      ) VALUES ${seedRows.join(', ')}
    `, seedValues);
    const candidate: MemoryCandidate = {
      type: 'preference', content: '强烈喜好 50', summary: 'Strong preference 50',
      normalizedKey: 'preference 50',
      confidence: 0.95, admissionScore: 7, explicitlyRequested: false,
      admissionReason: 'Higher-value preference', assessmentJson: '{}',
      sourceMessageIds: [ newMessageId ],
    };
    await repository.applyCandidates({
      userId,
      candidates: [ candidate ],
      now: new Date(now.getTime() + 10_000),
      expiryFor: () => undefined,
      limitFor: type => (type === 'preference' ? 5 : undefined),
      longTermLimit: 25,
      create: candidate => ({
        id: ulid(), userId, type: candidate.type, content: candidate.content,
        summary: candidate.summary,
        normalizedKey: candidate.normalizedKey, confidence: candidate.confidence,
        admissionScore: candidate.admissionScore,
        explicitlyRequested: candidate.explicitlyRequested,
        admissionReason: candidate.admissionReason,
        assessmentJson: candidate.assessmentJson,
        status: 'active',
        createdAt: new Date(now.getTime() + 10_000), updatedAt: new Date(now.getTime() + 10_000),
      }),
    });

    const active = (await repository.list(userId, new Date(now.getTime() + 20_000)))
      .filter(item => item.type === 'preference');
    assert.equal(active.length, 5);
    const [ rows ] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT status, COUNT(*) AS count FROM memories
      WHERE user_id = ? AND type = 'preference'
      GROUP BY status
    `, [ userId ]);
    assert.equal(Number(rows.find(row => row.status === 'active')?.count), 5);
    assert.equal(Number(rows.find(row => row.status === 'superseded')?.count), 1);
  });
});
