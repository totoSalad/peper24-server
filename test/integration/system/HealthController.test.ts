import { strict as assert } from 'node:assert';
import { app } from '@eggjs/mock/bootstrap';
import mysql from 'mysql2/promise';

describe('HealthController', () => {
  it('returns a wrapped health response and request id', async () => {
    const response = await app.httpRequest().get('/api/health').set('x-request-id', 'test-request');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.ok, true);
    assert.equal(response.body.data.service, 'peper24-server');
    assert.equal(response.body.requestId, 'test-request');
    assert.equal(response.headers['x-request-id'], 'test-request');
  });

  it('reports MySQL and Redis readiness', async () => {
    const response = await app.httpRequest().get('/api/ready');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, {
      ready: true,
      dependencies: { mysql: 'up', redis: 'up' },
    });
  });

  it('reports not ready when a required table disappears after the connection was established', async () => {
    // The preceding readiness test establishes the Realm connection. Simulate
    // drift in this isolated test database without touching development data.
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'peper24',
      password: process.env.MYSQL_PASSWORD ?? 'peper24_dev',
      database: process.env.MYSQL_DATABASE ?? 'peper24_test',
    });
    try {
      await connection.query('RENAME TABLE voice_recordings TO voice_recordings_readiness_hold');
      const response = await app.httpRequest().get('/api/ready');
      assert.equal(response.status, 503);
      assert.deepEqual(response.body.data.dependencies, { mysql: 'down', redis: 'up' });
    } finally {
      await connection.query('RENAME TABLE voice_recordings_readiness_hold TO voice_recordings');
      await connection.end();
    }
    await app.httpRequest().get('/api/ready').expect(200);
  });
});
