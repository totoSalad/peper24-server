import { strict as assert } from 'node:assert';
import { app } from '@eggjs/mock/bootstrap';
import mysql from 'mysql2/promise';
import { ulid } from 'ulid';

describe('MemoryController', () => {
  let connection: mysql.Connection;

  before(async () => {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'peper24',
      password: process.env.MYSQL_PASSWORD ?? 'peper24_dev',
      database: process.env.MYSQL_DATABASE ?? 'peper24_test',
    });
  });

  after(async () => connection.end());

  it('requires a session to trigger extraction', async () => {
    await app.httpRequest().post('/api/v1/memories/extractions')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .expect(401);
  });

  it('lists, corrects, and soft-deletes an owned memory while hiding expired memories', async () => {
    const registration = await app.httpRequest().post('/api/v1/auth/register')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .send({
        email: `memory-${Date.now()}@example.com`, password: 'integration-password',
        profile: { displayName: '记忆测试', englishLevel: 'B1' },
      })
      .expect(201);
    const setCookie = registration.headers['set-cookie'];
    assert.ok(setCookie);
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
    const userId = registration.body.data.user.id as string;
    const activeId = ulid();
    const expiredId = ulid();
    const now = new Date();

    const extraction = await app.httpRequest().post('/api/v1/memories/extractions')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(extraction.body.data.changedCount, 0);
    await connection.query(`
      INSERT INTO memories (
        id, user_id, type, content, summary, normalized_key, confidence,
        admission_score, explicitly_requested, admission_reason, assessment_json, status,
        expires_at, created_at, updated_at
      ) VALUES
        (?, ?, 'profile', '住在北京', 'Lives in Beijing', 'home-city', 0.9,
          7, 0, 'Stable profile', '{}', 'active', NULL, ?, ?),
        (?, ?, 'short_term', '上周出差', 'Traveled last week', 'business-trip', 0.9,
          4, 0, 'Temporary trip', '{}', 'active', ?, ?, ?)
    `, [ activeId, userId, now, now, expiredId, userId,
      new Date(now.getTime() - 1000), now, now ]);

    const list = await app.httpRequest().get('/api/v1/memories')
      .set('Cookie', cookie)
      .expect(200);
    assert.deepEqual(list.body.data.memories.map((item: { id: string }) => item.id), [ activeId ]);
    assert.equal(list.body.data.memories[0].summary, 'Lives in Beijing');

    const corrected = await app.httpRequest().patch(`/api/v1/memories/${activeId}`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ content: '住在上海', summary: 'Lives in Shanghai' })
      .expect(200);
    assert.equal(corrected.body.data.memory.content, '住在上海');
    assert.equal(corrected.body.data.memory.summary, 'Lives in Shanghai');

    await app.httpRequest().delete(`/api/v1/memories/${activeId}`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .expect(204);
    const empty = await app.httpRequest().get('/api/v1/memories')
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(empty.body.data.memories.length, 0);

    const [ rows ] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT action FROM memory_change_logs WHERE memory_id = ? ORDER BY id', [ activeId ],
    );
    assert.deepEqual(rows.map(row => row.action), [ 'correct', 'delete' ]);
  });
});
