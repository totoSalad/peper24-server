import { strict as assert } from 'node:assert';
import { app } from '@eggjs/mock/bootstrap';

async function register(label: string): Promise<string> {
  const response = await app.httpRequest().post('/api/v1/auth/register')
    .set('Host', 'localhost')
    .set('Origin', 'http://localhost')
    .send({
      email: `translation-${label}-${Date.now()}@example.com`,
      password: 'integration-password',
      profile: { displayName: label, englishLevel: 'B1' },
    })
    .expect(201);
  const setCookie = response.headers['set-cookie'];
  assert.ok(setCookie);
  return (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
}

describe('TranslationController', () => {
  it('translates an owned message once, caches it, and hides it from another user', async () => {
    const cookie = await register('owner');
    const otherCookie = await register('other');
    const creation = await app.httpRequest().post('/api/v1/conversations')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ topic: 'takeout' })
      .expect(201);
    const conversationId = creation.body.data.conversation.id as string;
    const messageId = creation.body.data.welcomeMessage.id as string;
    const translate = (sessionCookie: string) => app.httpRequest()
      .post(`/api/v1/messages/${messageId}/translation`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', sessionCookie)
      .send({});
    const first = await translate(cookie).expect(200);
    const cached = await translate(cookie).expect(200);
    assert.equal(first.body.data.translation, cached.body.data.translation);
    assert.ok(first.body.data.translation);
    await translate(otherCookie).expect(404);

    const messages = await app.httpRequest()
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(messages.body.data.messages[0].translation, first.body.data.translation);
  });
});
