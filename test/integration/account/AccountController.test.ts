import { strict as assert } from 'node:assert';
import { app } from '@eggjs/mock/bootstrap';

describe('AccountController', () => {
  it('completes registration, profile update and logout through HTTP', async () => {
    const email = `integration-${Date.now()}@example.com`;
    const origin = 'http://localhost';

    const registration = await app.httpRequest()
      .post('/api/v1/auth/register')
      .set('Host', 'localhost')
      .set('Origin', origin)
      .send({
        email,
        password: 'integration-password',
        profile: {
          displayName: '集成测试用户',
          age: 28,
          occupation: '工程师',
          englishLevel: 'B1',
        },
      });

    assert.equal(registration.status, 201, JSON.stringify(registration.body));
    assert.equal(registration.body.data.user.email, email);
    assert.equal(registration.body.data.user.profile.englishLevel, 'B1');
    const setCookie = registration.headers['set-cookie'];
    assert.ok(setCookie);
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];

    const current = await app.httpRequest()
      .get('/api/v1/me')
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(current.body.data.user.email, email);

    const updated = await app.httpRequest()
      .patch('/api/v1/me/profile')
      .set('Host', 'localhost')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({
        displayName: '新昵称',
        age: 29,
        occupation: '产品工程师',
        englishLevel: 'B2',
      })
      .expect(200);
    assert.equal(updated.body.data.user.profile.displayName, '新昵称');
    assert.equal(updated.body.data.user.profile.englishLevel, 'B2');

    await app.httpRequest()
      .post('/api/v1/auth/logout')
      .set('Host', 'localhost')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({})
      .expect(204);

    const unauthenticated = await app.httpRequest()
      .get('/api/v1/me')
      .set('Cookie', cookie)
      .expect(401);
    assert.equal(unauthenticated.body.error.code, 'UNAUTHENTICATED');
  });

  it('rejects state-changing browser requests from an untrusted origin', async () => {
    const response = await app.httpRequest()
      .post('/api/v1/auth/register')
      .set('Host', 'localhost')
      .set('Origin', 'https://attacker.example')
      .send({
        email: 'attacker@example.com',
        password: 'integration-password',
        profile: { displayName: 'test', englishLevel: 'B1' },
      })
      .expect(403);

    assert.equal(response.body.error.code, 'INVALID_ORIGIN');
  });
});
