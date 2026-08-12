import { strict as assert } from 'node:assert';
import { app } from '@eggjs/mock/bootstrap';
import { shanghaiDate } from '../../../app/module/learning-summary/service/LearningSummaryService';

async function register(label: string): Promise<string> {
  const response = await app.httpRequest()
    .post('/api/v1/auth/register')
    .set('Host', 'localhost')
    .set('Origin', 'http://localhost')
    .send({
      email: `${label}-${Date.now()}@example.com`,
      password: 'integration-password',
      profile: { displayName: label, englishLevel: 'B1' },
    })
    .expect(201);
  const setCookie = response.headers['set-cookie'];
  assert.ok(setCookie);
  return (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
}

describe('LearningSummaryController', () => {
  it('generates, reuses, lists and protects a daily learning summary', async () => {
    const cookie = await register('summary-owner');
    const otherCookie = await register('summary-other');
    const creation = await app.httpRequest()
      .post('/api/v1/conversations')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ topic: 'work' })
      .expect(201);
    const conversationId = creation.body.data.conversation.id as string;
    await app.httpRequest()
      .post(`/api/v1/conversations/${conversationId}/messages/stream`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ content: 'Yesterday I go home.', clientRequestId: 'summary-source-1' })
      .expect(200);

    const first = await app.httpRequest()
      .get('/api/v1/learning-summaries/today')
      .set('Cookie', cookie)
      .expect(200);
    const summary = first.body.data.summary;
    assert.equal(summary.date, shanghaiDate(new Date()));
    assert.equal(summary.status, 'completed');
    assert.equal(summary.metrics.conversationCount, 1);
    assert.equal(summary.metrics.userMessageCount, 1);
    assert.ok(summary.metrics.chatTokens > 0);
    assert.equal(summary.metrics.grammarErrorCount, 1);
    assert.ok(summary.content.headline);

    const replay = await app.httpRequest()
      .get('/api/v1/learning-summaries/today')
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(replay.body.data.summary.id, summary.id);
    assert.equal(replay.body.data.summary.generatedAt, summary.generatedAt);

    const history = await app.httpRequest()
      .get('/api/v1/learning-summaries?limit=10')
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(history.body.data.summaries.length, 1);
    assert.equal(history.body.data.summaries[0].id, summary.id);

    await app.httpRequest()
      .get(`/api/v1/learning-summaries/${summary.date}`)
      .set('Cookie', otherCookie)
      .expect(404);
    const emptyToday = await app.httpRequest()
      .get('/api/v1/learning-summaries/today')
      .set('Cookie', otherCookie)
      .expect(200);
    assert.equal(emptyToday.body.data.summary, null);
  });
});
