import { strict as assert } from 'node:assert';
import { app } from '@eggjs/mock/bootstrap';

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
});
