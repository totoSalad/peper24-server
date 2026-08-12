import { strict as assert } from 'node:assert';
import { app } from '@eggjs/mock/bootstrap';

describe('VocabularyController', () => {
  let cookie: string;
  let sourceMessageId: string;
  let concurrentSourceMessageId: string;

  before(async () => {
    const email = `vocabulary-${Date.now()}@example.com`;
    const registration = await app.httpRequest().post('/api/v1/auth/register')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .send({
        email, password: 'integration-password',
        profile: { displayName: '词汇测试', englishLevel: 'B1' },
      })
      .expect(201);
    const setCookie = registration.headers['set-cookie'];
    assert.ok(setCookie);
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];

    const creation = await app.httpRequest().post('/api/v1/conversations')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ topic: 'restaurant' })
      .expect(201);
    const conversationId = creation.body.data.conversation.id as string;
    await app.httpRequest().post(`/api/v1/conversations/${conversationId}/messages/stream`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ content: 'I bought whole wheat bread today.', clientRequestId: 'vocab-source' })
      .expect(200);
    const messages = await app.httpRequest()
      .get(`/api/v1/conversations/${conversationId}/messages`).set('Cookie', cookie)
      .expect(200);
    sourceMessageId = messages.body.data.messages.find(
      (message: { clientRequestId?: string }) => message.clientRequestId === 'vocab-source',
    ).id;

    await app.httpRequest().post(`/api/v1/conversations/${conversationId}/messages/stream`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ content: 'I ordered a cappuccino.', clientRequestId: 'vocab-concurrent-source' })
      .expect(200);
    const updatedMessages = await app.httpRequest()
      .get(`/api/v1/conversations/${conversationId}/messages`).set('Cookie', cookie)
      .expect(200);
    concurrentSourceMessageId = updatedMessages.body.data.messages.find(
      (message: { clientRequestId?: string }) => (
        message.clientRequestId === 'vocab-concurrent-source'
      ),
    ).id;
  });

  it('adds, deduplicates, reviews idempotently, and deletes an owned vocabulary', async () => {
    const add = () => app.httpRequest().post('/api/v1/vocabularies')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ expression: 'whole wheat bread', sourceMessageId });
    const first = await add().expect(201);
    const duplicate = await add().expect(201);
    const vocabularyId = first.body.data.vocabulary.id as string;
    assert.equal(duplicate.body.data.vocabulary.id, vocabularyId);

    const list = await app.httpRequest().get('/api/v1/vocabularies')
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(list.body.data.vocabularies.length, 1);
    const detail = list.body.data.vocabularies[0].detail;
    assert.equal(typeof detail.cnMeaning, 'string');
    assert.ok(detail.cnMeaning.length > 0);
    assert.ok(detail.enMeaning.length > 0);
    assert.ok(detail.example.length > 0);
    assert.ok(detail.phonetic.length > 0);

    const due = await app.httpRequest().get('/api/v1/reviews/today?limit=10')
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(due.body.data.reviews.length, 1);

    const answer = (result: string) => app.httpRequest()
      .post(`/api/v1/reviews/${vocabularyId}/answer`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ result, clientRequestId: 'review-idempotent' });
    const reviewed = await answer('good').expect(200);
    const replay = await answer('easy').expect(200);
    assert.equal(reviewed.body.data.review.score, 3);
    assert.deepEqual(replay.body.data.review, reviewed.body.data.review);

    await app.httpRequest().post(`/api/v1/reviews/${vocabularyId}/answer`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ result: 'good', score: 5, clientRequestId: 'forged-score' })
      .expect(400);

    await app.httpRequest().delete(`/api/v1/vocabularies/${vocabularyId}`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .expect(204);
    const empty = await app.httpRequest().get('/api/v1/vocabularies')
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(empty.body.data.vocabularies.length, 0);
  });

  it('converges concurrent duplicate additions and duplicate review requests', async () => {
    const add = () => app.httpRequest().post('/api/v1/vocabularies')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ expression: 'cappuccino', sourceMessageId: concurrentSourceMessageId });
    const [ first, second ] = await Promise.all([ add(), add() ]);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(first.body.data.vocabulary.id, second.body.data.vocabulary.id);
    const vocabularyId = first.body.data.vocabulary.id as string;

    const answer = (result: 'again' | 'easy') => app.httpRequest()
      .post(`/api/v1/reviews/${vocabularyId}/answer`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ result, clientRequestId: 'concurrent-review-request' });
    const [ reviewA, reviewB ] = await Promise.all([ answer('again'), answer('easy') ]);
    assert.equal(reviewA.status, 200, JSON.stringify(reviewA.body));
    assert.equal(reviewB.status, 200, JSON.stringify(reviewB.body));
    assert.deepEqual(reviewA.body.data.review, reviewB.body.data.review);
  });
});
