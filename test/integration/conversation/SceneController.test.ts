import { strict as assert } from 'node:assert';
import { app } from '@eggjs/mock/bootstrap';
import { SCENES } from '../../../app/module/ai/const/scene';

describe('SceneController', () => {
  let cookie: string;

  before(async () => {
    const email = `scenes-${Date.now()}@example.com`;
    const registration = await app.httpRequest()
      .post('/api/v1/auth/register')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .send({
        email,
        password: 'integration-password',
        profile: { displayName: '场景测试', englishLevel: 'B1' },
      })
      .expect(201);
    const setCookie = registration.headers['set-cookie'];
    assert.ok(setCookie);
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
  });

  it('lists the scene pool for an authenticated user', async () => {
    const response = await app.httpRequest()
      .get('/api/v1/scenes')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .expect(200);
    assert.deepEqual(response.body.data.scenes, SCENES);
  });

  it('requires authentication', async () => {
    await app.httpRequest()
      .get('/api/v1/scenes')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .expect(401);
  });
});
