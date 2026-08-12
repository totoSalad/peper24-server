import { strict as assert } from 'node:assert';
import { app } from '@eggjs/mock/bootstrap';
import mysql from 'mysql2/promise';
import type {
  Correction,
  GrammarAnalysisInput,
  ProductAIService,
} from '../../../app/module/ai/service/ProductAIService';

function eventTypes(body: string): string[] {
  return body
    .split('\n\n')
    .map(block => block.match(/^event: (.+)$/m)?.[1])
    .filter((value): value is string => Boolean(value));
}

function events(body: string): Array<{
  type: string;
  messageId?: string;
  correction?: { errorType: string; original: string; corrected: string; note: string };
}> {
  return body
    .split('\n\n')
    .map(block => block.match(/^data: (.+)$/m)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(value => JSON.parse(value));
}

describe('ConversationController', () => {
  let cookie: string;

  before(async () => {
    const email = `conversation-${Date.now()}@example.com`;
    const registration = await app.httpRequest()
      .post('/api/v1/auth/register')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .send({
        email,
        password: 'integration-password',
        profile: { displayName: '会话测试', englishLevel: 'B1' },
      })
      .expect(201);
    const setCookie = registration.headers['set-cookie'];
    assert.ok(setCookie);
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
  });

  it('creates, lists and streams an idempotent conversation exchange', async () => {
    const creation = await app.httpRequest()
      .post('/api/v1/conversations')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ topic: 'hiking' })
      .expect(201);
    const conversationId = creation.body.data.conversation.id as string;
    assert.equal(creation.body.data.welcomeMessage.role, 'assistant');

    const list = await app.httpRequest()
      .get('/api/v1/conversations')
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(list.body.data.conversations[0].id, conversationId);

    const stream = await app.httpRequest()
      .post(`/api/v1/conversations/${conversationId}/messages/stream`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .set('Accept', 'text/event-stream')
      .send({ content: 'I went hiking yesterday.', clientRequestId: 'web-request-1' })
      .expect(200);
    assert.match(stream.headers['content-type'], /^text\/event-stream/);
    const streamedTypes = eventTypes(stream.text);
    assert.equal(streamedTypes[0], 'message.start');
    assert.equal(streamedTypes.at(-1), 'message.done');
    assert.ok(streamedTypes.slice(1, -1).length > 0);
    assert.ok(streamedTypes.slice(1, -1).every(type => type === 'message.delta'));

    const refreshedList = await app.httpRequest()
      .get('/api/v1/conversations')
      .set('Cookie', cookie)
      .expect(200);
    const messageHistory = await app.httpRequest()
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('Cookie', cookie)
      .expect(200);
    const latestMessage = messageHistory.body.data.messages.at(-1);
    assert.equal(refreshedList.body.data.conversations[0].lastMessage.role, 'assistant');
    assert.equal(refreshedList.body.data.conversations[0].lastMessage.id, latestMessage.id);
    assert.equal(refreshedList.body.data.conversations[0].lastMessage.content, latestMessage.content);
    assert.equal(refreshedList.body.data.conversations[0].lastMessage.sequence, latestMessage.sequence);

    const replay = await app.httpRequest()
      .post(`/api/v1/conversations/${conversationId}/messages/stream`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ content: 'ignored on replay', clientRequestId: 'web-request-1' })
      .expect(200);
    assert.deepEqual(eventTypes(replay.text), [
      'message.start',
      'message.delta',
      'message.done',
    ]);

    const completedBeforeInterruption = await app.httpRequest()
      .post(`/api/v1/conversations/${conversationId}/messages/stream`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ content: 'Please retry this.', clientRequestId: 'web-request-interrupted' })
      .expect(200);
    const interruptedMessageId = events(completedBeforeInterruption.text)
      .find(event => event.type === 'message.start')?.messageId;
    assert.ok(interruptedMessageId);
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'peper24',
      password: process.env.MYSQL_PASSWORD ?? 'peper24_dev',
      database: process.env.MYSQL_DATABASE ?? 'peper24_test',
    });
    try {
      const [ usageRows ] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT message_id FROM ai_usage_logs WHERE conversation_id = ?',
        [ conversationId ],
      );
      assert.equal(usageRows.length, 2);
      await connection.query('DELETE FROM ai_usage_logs WHERE message_id = ?', [ interruptedMessageId ]);
      await connection.query(
        'UPDATE messages SET status = ?, content = ? WHERE id = ?',
        [ 'interrupted', 'Partial', interruptedMessageId ],
      );
    } finally {
      await connection.end();
    }
    const resumed = await app.httpRequest()
      .post(`/api/v1/conversations/${conversationId}/messages/stream`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ content: 'Please retry this.', clientRequestId: 'web-request-interrupted' })
      .expect(200);
    assert.equal(eventTypes(resumed.text)[0], 'message.start');
    assert.equal(eventTypes(resumed.text).at(-1), 'message.done');

    const messages = await app.httpRequest()
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('Cookie', cookie)
      .expect(200);
    const messageList = messages.body.data.messages;
    assert.equal(messageList.length, 5);
    assert.deepEqual(messageList.map((message: { sequence: number }) => message.sequence), [
      1, 2, 3, 4, 5,
    ]);
    const firstUserMessage = messageList.find(
      (message: { clientRequestId?: string }) => message.clientRequestId === 'web-request-1',
    );
    assert.ok(firstUserMessage);
    const firstReply = messageList.find(
      (message: { replyToMessageId?: string }) => message.replyToMessageId === firstUserMessage.id,
    );
    assert.equal(firstReply.status, 'completed');
    const resumedUserMessage = messageList.find(
      (message: { clientRequestId?: string }) => (
        message.clientRequestId === 'web-request-interrupted'
      ),
    );
    assert.ok(resumedUserMessage);
    const resumedReply = messageList.find(
      (message: { replyToMessageId?: string }) => (
        message.replyToMessageId === resumedUserMessage.id
      ),
    );
    assert.equal(resumedReply.status, 'completed');
    assert.notEqual(resumedReply.content, 'Partial');
  });

  it('persists user-level grammar frequency and emits corrections exactly once', async () => {
    // Mock 语法分析为确定性输出，避免真实 AI 检测波动导致偶发失败。
    const ai = (await app.getEggObjectFromName('ProductAIService')) as ProductAIService;
    const originalAnalyzeGrammar = ai.analyzeGrammar;
    ai.analyzeGrammar = (input: GrammarAnalysisInput) => {
      const errors: Correction[] = [];
      const agreement = input.content.match(/\b(she|he|it)\s+like\b/i);
      if (agreement) {
        errors.push({
          errorType: 'subject_verb_agreement',
          original: agreement[0],
          corrected: agreement[0].replace(/\blike\b/i, 'likes'),
          note: '第三人称单数主语后的动词需要加 s。',
        });
      }
      const tense = input.content.match(/\byesterday\b[^.?!]*\bgo\b/i);
      if (tense) {
        errors.push({
          errorType: 'tense',
          original: tense[0],
          corrected: tense[0].replace(/\bgo\b/i, 'went'),
          note: '过去发生的事情通常使用过去式。',
        });
      }
      const article = input.content.match(/\b(bought|has)\s+(book|cat)\b/i);
      if (article) {
        errors.push({
          errorType: 'article',
          original: article[0],
          corrected: `${article[1]} a ${article[2]}`,
          note: '可数名词单数前通常需要冠词。',
        });
      }
      const preposition = input.content.match(/\bdepend\s+of\b/i);
      if (preposition) {
        errors.push({
          errorType: 'preposition_collocation',
          original: preposition[0],
          corrected: preposition[0].replace(/\bof\b/i, 'on'),
          note: 'depend 通常与介词 on 搭配。',
        });
      }
      return Promise.resolve({ explicitGrammarQuestion: false, errors });
    };

    const creation = await app.httpRequest()
      .post('/api/v1/conversations')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ topic: 'small talk' })
      .expect(201);
    const conversationId = creation.body.data.conversation.id as string;

    const send = (content: string, clientRequestId: string) => app.httpRequest()
      .post(`/api/v1/conversations/${conversationId}/messages/stream`)
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ content, clientRequestId })
      .expect(200);

    const first = await send('She like music.', 'grammar-subject-1');
    const second = await send('He like sports.', 'grammar-subject-2');
    const third = await send('It like coffee.', 'grammar-subject-3');
    assert.equal(eventTypes(first.text).includes('correction.ready'), false);
    assert.equal(eventTypes(second.text).filter(type => type === 'correction.ready').length, 1);
    assert.equal(eventTypes(third.text).includes('correction.ready'), false);

    const replay = await send('ignored', 'grammar-subject-2');
    assert.equal(eventTypes(replay.text).filter(type => type === 'correction.ready').length, 1);

    await send('Yesterday I go home and I bought book.', 'grammar-multiple-1');
    const multiple = await send(
      'Yesterday she go home and she has cat.',
      'grammar-multiple-2',
    );
    assert.deepEqual(
      events(multiple.text)
        .filter(event => event.type === 'correction.ready')
        .map(event => event.correction?.errorType),
      [ 'article', 'tense' ],
    );

    const [ concurrentA, concurrentB ] = await Promise.all([
      send('I depend of my friends.', 'grammar-concurrent-1'),
      send('We depend of our team.', 'grammar-concurrent-2'),
    ]);
    const concurrentCorrectionCount = [ concurrentA, concurrentB ]
      .flatMap(response => eventTypes(response.text))
      .filter(type => type === 'correction.ready')
      .length;
    assert.equal(concurrentCorrectionCount, 1);

    const messages = await app.httpRequest()
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('Cookie', cookie)
      .expect(200);
    const correctedMessages = messages.body.data.messages.filter(
      (message: { corrections?: unknown[] }) => (message.corrections?.length ?? 0) > 0,
    );
    assert.ok(correctedMessages.length >= 3);

    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'peper24',
      password: process.env.MYSQL_PASSWORD ?? 'peper24_dev',
      database: process.env.MYSQL_DATABASE ?? 'peper24_test',
    });
    try {
      const [ patternRows ] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT p.error_type, p.occurrence_count, p.corrected_at
        FROM grammar_error_patterns p
        JOIN conversations c ON c.user_id = p.user_id
        WHERE c.id = ?
        ORDER BY p.error_type
      `, [ conversationId ]);
      const subject = patternRows.find(row => row.error_type === 'subject_verb_agreement');
      const preposition = patternRows.find(row => row.error_type === 'preposition_collocation');
      assert.equal(subject?.occurrence_count, 3);
      assert.ok(subject?.corrected_at);
      assert.equal(preposition?.occurrence_count, 2);
      assert.ok(preposition?.corrected_at);

      const [ occurrenceRows ] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT COUNT(*) AS count
        FROM grammar_error_occurrences o
        JOIN grammar_error_patterns p ON p.id = o.pattern_id
        WHERE p.user_id = (SELECT user_id FROM conversations WHERE id = ?)
          AND p.error_type = 'preposition_collocation'
      `, [ conversationId ]);
      assert.equal(occurrenceRows[0].count, 2);
    } finally {
      await connection.end();
    }
    ai.analyzeGrammar = originalAnalyzeGrammar;
  });

  it('returns a non-retryable SSE error after the daily chat token limit is reached', async () => {
    const originalLimit = process.env.DAILY_CHAT_TOKEN_LIMIT;
    const creation = await app.httpRequest()
      .post('/api/v1/conversations')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send({ topic: 'restaurant' })
      .expect(201);
    const conversationId = creation.body.data.conversation.id as string;

    try {
      await app.httpRequest()
        .post(`/api/v1/conversations/${conversationId}/messages/stream`)
        .set('Host', 'localhost')
        .set('Origin', 'http://localhost')
        .set('Cookie', cookie)
        .send({ content: 'Start the quota test.', clientRequestId: 'daily-limit-seed' })
        .expect(200);
      const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST ?? '127.0.0.1',
        port: Number(process.env.MYSQL_PORT ?? 3306),
        user: process.env.MYSQL_USER ?? 'peper24',
        password: process.env.MYSQL_PASSWORD ?? 'peper24_dev',
        database: process.env.MYSQL_DATABASE ?? 'peper24_test',
      });
      try {
        const [ rows ] = await connection.query<mysql.RowDataPacket[]>(`
          SELECT daily_usage.token_count, daily_usage.usage_date
          FROM daily_chat_token_usages daily_usage
          JOIN conversations c ON c.user_id = daily_usage.user_id
          WHERE c.id = ?
        `, [ conversationId ]);
        assert.ok(Number(rows[0].token_count) > 0);
        assert.ok(rows[0].usage_date);
      } finally {
        await connection.end();
      }
      process.env.DAILY_CHAT_TOKEN_LIMIT = '1';
      const limited = await app.httpRequest()
        .post(`/api/v1/conversations/${conversationId}/messages/stream`)
        .set('Host', 'localhost')
        .set('Origin', 'http://localhost')
        .set('Cookie', cookie)
        .send({ content: 'Can we keep talking?', clientRequestId: 'daily-limit-http' })
        .expect(200);

      const error = events(limited.text).at(-1) as {
        type: string;
        code?: string;
        retryable?: boolean;
      };
      assert.equal(error.type, 'error');
      assert.equal(error.code, 'DAILY_CHAT_TOKEN_LIMIT_EXCEEDED');
      assert.equal(error.retryable, false);
    } finally {
      if (originalLimit === undefined) delete process.env.DAILY_CHAT_TOKEN_LIMIT;
      else process.env.DAILY_CHAT_TOKEN_LIMIT = originalLimit;
    }
  });
});
