import { strict as assert } from 'node:assert';
import type { Logger } from '@eggjs/tegg';
import { findScene } from '../../../app/module/ai/const/scene';
import {
  ConversationService,
  extractEmbeddedChineseExpressions,
} from '../../../app/module/conversation/service/ConversationService';
import { GrammarService } from '../../../app/module/grammar/service/GrammarService';
import { AppError } from '../../../app/module/system/error/AppError';
import { VocabularyService } from '../../../app/module/vocabulary/service/VocabularyService';
import { FakeClock, FixedIdGenerator } from '../../support/fake/AccountFakes';
import {
  FakeProductAIService,
  InMemoryConversationRepository,
} from '../../support/fake/ConversationFakes';
import { InMemoryVocabularyRepository } from '../../support/fake/VocabularyFakes';
import { MemoryService } from '../../../app/module/memory/service/MemoryService';
import { InMemoryMemoryRepository } from '../../support/fake/MemoryFakes';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

const noopLogger: Logger = {
  debug() {},
  log() {},
  info() {},
  warn() {},
  error() {},
};

describe('ConversationService', () => {
  it('extracts Chinese fragments only when embedded in an English message', () => {
    assert.deepEqual(extractEmbeddedChineseExpressions(
      'It\'s special food in my home town. It\'s made of meat and "白萝卜".',
    ), [ '白萝卜' ]);
    assert.deepEqual(extractEmbeddedChineseExpressions('白萝卜怎么说？'), []);
    assert.deepEqual(extractEmbeddedChineseExpressions('白萝卜怎么用 AI 翻译？'), []);
    assert.deepEqual(extractEmbeddedChineseExpressions('It is called "拼豆" in Chinese.'), []);
    assert.deepEqual(extractEmbeddedChineseExpressions('She is "梁静茹".'), []);
    assert.deepEqual(extractEmbeddedChineseExpressions('Her name is “梁静茹”.'), []);
    assert.deepEqual(extractEmbeddedChineseExpressions('I ate 白萝卜 with 白萝卜 and 胡萝卜.'),
      [ '白萝卜', '胡萝卜' ]);
  });

  const now = new Date('2026-08-06T01:00:00.000Z');
  const originalDailyChatTokenLimit = process.env.DAILY_CHAT_TOKEN_LIMIT;

  afterEach(() => {
    if (originalDailyChatTokenLimit === undefined) delete process.env.DAILY_CHAT_TOKEN_LIMIT;
    else process.env.DAILY_CHAT_TOKEN_LIMIT = originalDailyChatTokenLimit;
  });

  function setup(logger: Logger = noopLogger) {
    const repository = new InMemoryConversationRepository();
    const ai = new FakeProductAIService();
    const vocabularyRepository = new InMemoryVocabularyRepository();
    const vocabulary = new VocabularyService(
      vocabularyRepository,
      ai,
      new FixedIdGenerator([ '01TOOLVOCAB', '01TOOLCONTEXT' ]),
      new FakeClock(now),
      noopLogger,
    );
    const memoryRepository = new InMemoryMemoryRepository();
    const memory = new MemoryService(
      memoryRepository, new FixedIdGenerator([]), new FakeClock(now),
    );
    const service = new ConversationService(
      repository,
      ai,
      new FixedIdGenerator([
        '01CONVERSATION',
        '01WELCOME',
        '01USERMESSAGE',
        '01ASSISTANT',
        '01IGNOREDUSER',
        '01IGNOREDASSISTANT',
        '01FAILEDUSER',
        '01FAILEDASSISTANT',
      ]),
      new FakeClock(now),
      new GrammarService(),
      vocabulary,
      memory,
      logger,
    );
    return { repository, vocabularyRepository, memoryRepository, ai, service };
  }

  it('creates a conversation with an AI welcome message and the pool scene', async () => {
    const { ai, repository, service } = setup();

    const learner = { displayName: '小明', englishLevel: 'B1' as const };
    const created = await service.createConversation(
      '01USER',
      { topic: '  hiking  ' },
      learner,
    );

    assert.equal(created.conversation.id, '01CONVERSATION');
    assert.equal(created.conversation.topic, 'hiking');
    assert.equal(created.conversation.scene, findScene('hiking')?.scene);
    // 新会话从 0 开始累计折叠边界。
    const stored = await repository.findByIdForUser('01CONVERSATION', '01USER');
    assert.equal(stored?.summaryFoldedUntil, 0);
    assert.equal(created.welcomeMessage.id, '01WELCOME');
    assert.equal(created.welcomeMessage.sequence, 1);
    assert.equal(created.welcomeMessage.role, 'assistant');
    assert.equal(created.welcomeMessage.status, 'completed');
    assert.deepEqual(ai.welcomeInputs[0].learner, { ...learner, memories: [] });
  });

  it('rejects a topic that is not in the scene pool', async () => {
    const { service } = setup();

    await assert.rejects(
      service.createConversation('01USER', { topic: 'Custom topic' }),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_TOPIC',
    );
  });

  it('streams an exchange and persists the completed assistant message before done', async () => {
    const { ai, repository, service } = setup();
    await service.createConversation('01USER', { topic: 'restaurant' });

    const learner = { displayName: '小明', englishLevel: 'A2' as const };
    const events = await collect(service.streamMessage(
      '01USER',
      '01CONVERSATION',
      { content: 'I like coffee.', clientRequestId: 'client-request-1' },
      learner,
    ));

    assert.deepEqual(events.map(event => event.type), [
      'message.start',
      'message.delta',
      'message.delta',
      'message.done',
    ]);
    const messages = await repository.listMessages('01CONVERSATION', '01USER');
    assert.equal(messages?.length, 3);
    assert.deepEqual(messages?.map(message => message.sequence), [ 1, 2, 3 ]);
    assert.equal(messages?.[1].clientRequestId, 'client-request-1');
    assert.equal(messages?.[2].content, 'That sounds great!');
    assert.equal(messages?.[2].status, 'completed');
    assert.deepEqual(ai.chatInputs[0].learner, { ...learner, memories: [] });
    assert.deepEqual(repository.usageByMessage.get('01ASSISTANT'), {
      provider: 'fake',
      model: 'fake-chat',
      inputTokens: 3,
      outputTokens: 4,
    });
  });

  it('includes the latest message in each conversation list item', async () => {
    const { service } = setup();
    await service.createConversation('01USER', { topic: 'restaurant' });
    await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'I like coffee.', clientRequestId: 'latest-message-request',
    }));

    const conversations = await service.listConversations('01USER');

    assert.equal(conversations[0].lastMessage?.id, '01ASSISTANT');
    assert.equal(conversations[0].lastMessage?.role, 'assistant');
    assert.equal(conversations[0].lastMessage?.content, 'That sounds great!');
  });

  it('injects active memories into welcome and chat learner context', async () => {
    const { ai, memoryRepository, service } = setup();
    memoryRepository.items.push({
      id: 'm1', userId: '01USER', type: 'preference', content: '喜欢徒步',
      summary: 'Enjoys hiking',
      normalizedKey: 'hiking', confidence: 0.9, status: 'active',
      admissionScore: 7, explicitlyRequested: false,
      admissionReason: 'Stable hobby', assessmentJson: '{}',
      createdAt: now, updatedAt: now,
    });
    await service.createConversation('01USER', { topic: 'hiking' }, { englishLevel: 'B1' });
    await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'Hello.', clientRequestId: 'memory-request',
    }, { englishLevel: 'B1' }));
    assert.deepEqual(ai.welcomeInputs[0].learner?.memories, [
      { type: 'preference', content: 'Enjoys hiking' },
    ]);
    assert.deepEqual(ai.chatInputs[0].learner?.memories, [
      { type: 'preference', content: 'Enjoys hiking' },
    ]);
  });

  it('replays a completed response for a duplicate client request without calling AI twice', async () => {
    const { ai, repository, service } = setup();
    await service.createConversation('01USER', { topic: 'restaurant' });
    const input = { content: 'I like coffee.', clientRequestId: 'client-request-1' };

    await collect(service.streamMessage('01USER', '01CONVERSATION', input));
    const replay = await collect(service.streamMessage('01USER', '01CONVERSATION', input));

    assert.equal(ai.chatCalls, 1);
    assert.deepEqual(replay.map(event => event.type), [
      'message.start',
      'message.delta',
      'message.done',
    ]);
    assert.equal((await repository.listMessages('01CONVERSATION', '01USER'))?.length, 3);
  });

  it('rejects a new exchange when the user has reached the daily chat token limit', async () => {
    process.env.DAILY_CHAT_TOKEN_LIMIT = '10';
    const { ai, repository, service } = setup();
    await service.createConversation('01USER', { topic: 'restaurant' });
    repository.dailyChatTokens.set('01USER:2026-08-06', 10);

    await assert.rejects(
      async () => collect(service.streamMessage('01USER', '01CONVERSATION', {
        content: 'One more message.', clientRequestId: 'over-daily-limit',
      })),
      (error: unknown) => error instanceof AppError
        && error.code === 'DAILY_CHAT_TOKEN_LIMIT_EXCEEDED'
        && error.status === 429,
    );
    assert.equal(ai.chatCalls, 0);
    assert.equal((await repository.listMessages('01CONVERSATION', '01USER'))?.length, 1);
  });

  it('resets the chat token allowance at the next UTC day', async () => {
    process.env.DAILY_CHAT_TOKEN_LIMIT = '10';
    const { ai, repository, service } = setup();
    await service.createConversation('01USER', { topic: 'restaurant' });
    repository.dailyChatTokens.set('01USER:2026-08-05', 200);

    const events = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'A new day.', clientRequestId: 'new-utc-day',
    }));

    assert.equal(events.at(-1)?.type, 'message.done');
    assert.equal(ai.chatCalls, 1);
  });

  it('replays an idempotent completed response after the daily limit is reached', async () => {
    process.env.DAILY_CHAT_TOKEN_LIMIT = '7';
    const { ai, service } = setup();
    await service.createConversation('01USER', { topic: 'restaurant' });
    const input = { content: 'I like coffee.', clientRequestId: 'quota-replay' };
    await collect(service.streamMessage('01USER', '01CONVERSATION', input));

    const replay = await collect(service.streamMessage('01USER', '01CONVERSATION', input));

    assert.equal(replay.at(-1)?.type, 'message.done');
    assert.equal(ai.chatCalls, 1);
  });

  it('does not expose conversations owned by another user', async () => {
    const { service } = setup();
    await service.createConversation('01USER', { topic: 'restaurant' });

    await assert.rejects(
      async () => collect(service.streamMessage('01OTHER', '01CONVERSATION', {
        content: 'Hello',
        clientRequestId: 'client-request-2',
      })),
      (error: unknown) => error instanceof AppError && error.code === 'CONVERSATION_NOT_FOUND',
    );
  });

  it('marks partial AI output as interrupted and emits a retryable error', async () => {
    const { ai, repository, service } = setup();
    await service.createConversation('01USER', { topic: 'restaurant' });
    ai.deltas = [ 'Partial' ];
    ai.failure = new Error('provider unavailable');

    const events = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'Hello',
      clientRequestId: 'client-request-failed',
    }));

    assert.equal(events.at(-1)?.type, 'error');
    let messages = await repository.listMessages('01CONVERSATION', '01USER');
    assert.equal(messages?.at(-1)?.content, 'Partial');
    assert.equal(messages?.at(-1)?.status, 'interrupted');

    ai.failure = undefined;
    ai.deltas = [ 'Recovered' ];
    const retry = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'Hello',
      clientRequestId: 'client-request-failed',
    }));

    assert.equal(retry.at(-1)?.type, 'message.done');
    assert.equal(ai.chatCalls, 2);
    messages = await repository.listMessages('01CONVERSATION', '01USER');
    assert.equal(messages?.length, 3);
    assert.equal(messages?.at(-1)?.content, 'Recovered');
    assert.equal(messages?.at(-1)?.status, 'completed');
  });

  it('stays silent on the first grammar occurrence, corrects the second, then stays silent', async () => {
    const { ai, service } = setup();
    await service.createConversation('01USER', { topic: 'work' });
    ai.grammarAnalysis = {
      explicitGrammarQuestion: false,
      errors: [
        {
          errorType: 'subject_verb_agreement',
          original: 'She like music.',
          corrected: 'She likes music.',
          note: '第三人称单数动词需要加 s。',
        },
      ],
    };

    const first = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'She like music.',
      clientRequestId: 'grammar-1',
    }));
    const second = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'He like sports.',
      clientRequestId: 'grammar-2',
    }));
    const third = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'Tom like coffee.',
      clientRequestId: 'grammar-3',
    }));

    assert.equal(first.some(event => event.type === 'correction.ready'), false);
    assert.equal(second.filter(event => event.type === 'correction.ready').length, 1);
    assert.equal(third.some(event => event.type === 'correction.ready'), false);
    assert.equal(second.at(-2)?.type, 'correction.ready');
    assert.equal(second.at(-1)?.type, 'message.done');
  });

  it('emits every concrete correction for all error types reaching the threshold', async () => {
    const { ai, service } = setup();
    await service.createConversation('01USER', { topic: 'work' });
    ai.grammarAnalysis = {
      explicitGrammarQuestion: false,
      errors: [
        {
          errorType: 'article',
          original: 'I bought book.',
          corrected: 'I bought a book.',
          note: '可数名词单数前通常需要冠词。',
        },
        {
          errorType: 'article',
          original: 'She has cat.',
          corrected: 'She has a cat.',
          note: '可数名词单数前通常需要冠词。',
        },
        {
          errorType: 'tense',
          original: 'Yesterday I go home.',
          corrected: 'Yesterday I went home.',
          note: '过去发生的事情使用过去式。',
        },
      ],
    };

    await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'First occurrence',
      clientRequestId: 'multiple-1',
    }));
    const second = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'Second occurrence',
      clientRequestId: 'multiple-2',
    }));

    const corrections = second.filter(event => event.type === 'correction.ready');
    assert.equal(corrections.length, 3);
    assert.deepEqual(
      corrections.map(event => event.type === 'correction.ready' && event.correction.errorType),
      [ 'article', 'article', 'tense' ],
    );
  });

  it('replays stored corrections without analyzing or counting a duplicate request', async () => {
    const { ai, service } = setup();
    await service.createConversation('01USER', { topic: 'work' });
    ai.grammarAnalysis = {
      explicitGrammarQuestion: false,
      errors: [
        {
          errorType: 'tense',
          original: 'Yesterday I go home.',
          corrected: 'Yesterday I went home.',
          note: '过去发生的事情使用过去式。',
        },
      ],
    };
    await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'Yesterday I go home.',
      clientRequestId: 'replay-1',
    }));
    const input = { content: 'Yesterday she go home.', clientRequestId: 'replay-2' };
    const original = await collect(service.streamMessage('01USER', '01CONVERSATION', input));
    const replay = await collect(service.streamMessage('01USER', '01CONVERSATION', input));

    assert.equal(original.filter(event => event.type === 'correction.ready').length, 1);
    assert.equal(replay.filter(event => event.type === 'correction.ready').length, 1);
    assert.equal(ai.chatCalls, 2);
    assert.equal(ai.grammarAnalysisCalls, 2);
  });

  it('keeps grammar analysis failures isolated from chat and does not count them', async () => {
    const { ai, service } = setup();
    await service.createConversation('01USER', { topic: 'work' });
    ai.grammarFailure = new Error('invalid structured output');
    const failedAnalysis = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'Yesterday I go home.',
      clientRequestId: 'analysis-failed',
    }));
    assert.equal(failedAnalysis.at(-1)?.type, 'message.done');

    ai.grammarFailure = undefined;
    ai.grammarAnalysis = {
      explicitGrammarQuestion: false,
      errors: [
        {
          errorType: 'tense',
          original: 'Yesterday I go home.',
          corrected: 'Yesterday I went home.',
          note: '过去发生的事情使用过去式。',
        },
      ],
    };
    const firstCounted = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'Yesterday she go home.',
      clientRequestId: 'analysis-success-1',
    }));
    const secondCounted = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'Yesterday he go home.',
      clientRequestId: 'analysis-success-2',
    }));

    assert.equal(firstCounted.some(event => event.type === 'correction.ready'), false);
    assert.equal(secondCounted.filter(event => event.type === 'correction.ready').length, 1);
  });

  it('starts grammar analysis before consuming the chat stream', async () => {
    const { ai, service } = setup();
    await service.createConversation('01USER', { topic: 'work' });
    ai.requireGrammarStartedBeforeChat = true;

    const events = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'I enjoy talking.',
      clientRequestId: 'parallel-analysis',
    }));

    assert.equal(events.at(-1)?.type, 'message.done');
    assert.equal(ai.grammarAnalysisCalls, 1);
  });

  it('does not count grammar candidates when the main chat stream fails', async () => {
    const { ai, service } = setup();
    await service.createConversation('01USER', { topic: 'work' });
    ai.grammarAnalysis = {
      explicitGrammarQuestion: false,
      errors: [
        {
          errorType: 'tense',
          original: 'Yesterday I go home.',
          corrected: 'Yesterday I went home.',
          note: '过去发生的事情使用过去式。',
        },
      ],
    };
    ai.failure = new Error('chat provider failed');
    await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'Yesterday I go home.',
      clientRequestId: 'failed-chat',
    }));

    ai.failure = undefined;
    const retry = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'Yesterday I go home.',
      clientRequestId: 'failed-chat',
    }));
    const next = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'Yesterday she go home.',
      clientRequestId: 'after-failed-chat',
    }));

    assert.equal(retry.some(event => event.type === 'correction.ready'), false);
    assert.equal(next.filter(event => event.type === 'correction.ready').length, 1);
  });

  it('executes expression tools, saves the vocabulary, and replays tool events idempotently', async () => {
    const { ai, vocabularyRepository, service } = setup();
    await service.createConversation('01USER', { topic: 'work' });
    ai.vocabularyEnrichment = {
      cnMeaning: '差点迟到', enMeaning: 'almost late',
      example: 'I was almost late today.',
      phonetic: '/ˈɔːlmoʊst leɪt/',
    };
    const input = { content: '“我今天差点迟到了”怎么说？', clientRequestId: 'tool-request' };
    const first = await collect(service.streamMessage('01USER', '01CONVERSATION', input));
    const replay = await collect(service.streamMessage('01USER', '01CONVERSATION', input));

    assert.deepEqual(first.filter(event => event.type.startsWith('tool.')).map(event => event.type), [
      'tool.call', 'tool.result',
    ]);
    assert.equal(vocabularyRepository.items.length, 1);
    assert.equal(ai.vocabularyCalls, 1);
    assert.deepEqual(replay.filter(event => event.type.startsWith('tool.')).map(event => event.type), [
      'tool.call', 'tool.result',
    ]);
    assert.equal(ai.chatCalls, 1);
  });

  it('triggers the expression tool for the "how to say" quick-tool format', async () => {
    const { ai, vocabularyRepository, service } = setup();
    await service.createConversation('01USER', { topic: 'work' });
    ai.vocabularyEnrichment = {
      cnMeaning: '差点迟到', enMeaning: 'almost late',
      example: 'I was almost late today.',
      phonetic: '/ˈɔːlmoʊst leɪt/',
    };
    const input = { content: 'how to say "我今天差点迟到了"', clientRequestId: 'tool-request-how-to-say' };
    const events = await collect(service.streamMessage('01USER', '01CONVERSATION', input));

    assert.deepEqual(events.filter(event => event.type.startsWith('tool.')).map(event => event.type), [
      'tool.call', 'tool.result',
    ]);
    assert.equal(vocabularyRepository.items.length, 1);
    assert.equal(ai.vocabularyCalls, 1);
  });

  it('converts a Chinese tool text to English (via enMeaning) before saving it', async () => {
    const { ai, vocabularyRepository, service } = setup();
    await service.createConversation('01USER', { topic: 'work' });
    ai.vocabularyEnrichment = {
      cnMeaning: '差点迟到', enMeaning: 'almost late',
      example: 'I was almost late today.',
      phonetic: '/ˈɔːlmoʊst leɪt/',
    };
    const input = { content: 'how to say "我今天差点迟到了"', clientRequestId: 'tool-convert' };
    await collect(service.streamMessage('01USER', '01CONVERSATION', input));

    assert.equal(vocabularyRepository.items.length, 1);
    assert.equal(vocabularyRepository.items[0].expression, 'almost late');
  });

  it('automatically explains and saves a Chinese fragment embedded in English', async () => {
    const { ai, vocabularyRepository, service } = setup();
    await service.createConversation('01USER', { topic: 'cooking' });
    ai.vocabularyEnrichment = {
      cnMeaning: '白萝卜', enMeaning: 'daikon radish',
      example: 'This dish is made with meat and daikon radish.',
      phonetic: '/ˈdaɪkɑːn ˈrædɪʃ/',
    };
    const input = {
      content: 'It\'s special food in my home town. It\'s make of meat and "白萝卜".',
      clientRequestId: 'tool-embedded-chinese',
    };
    const events = await collect(service.streamMessage('01USER', '01CONVERSATION', input));

    assert.deepEqual(ai.chatInputs[0].requiredExpressions, [ '白萝卜' ]);
    assert.deepEqual(events.filter(event => event.type.startsWith('tool.')).map(event => event.type),
      [ 'tool.call', 'tool.result' ]);
    assert.equal(ai.vocabularyCalls, 1);
    assert.equal(vocabularyRepository.items.length, 1);
    assert.equal(vocabularyRepository.items[0].expression, 'daikon radish');
    assert.equal(vocabularyRepository.contexts[0].sentence, input.content);
  });

  it('silently ignores an embedded person name rejected by vocabulary enrichment', async () => {
    const { ai, vocabularyRepository, service } = setup();
    await service.createConversation('01USER', { topic: 'music' });
    ai.vocabularyEnrichment = null;
    const events = await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'I listened to 梁静茹 yesterday and loved her voice.',
      clientRequestId: 'tool-person-name',
    }));

    assert.deepEqual(ai.chatInputs[0].requiredExpressions, [ '梁静茹' ]);
    assert.equal(events.some(event => event.type.startsWith('tool.')), false);
    assert.equal(vocabularyRepository.items.length, 0);
  });

  it('logs a name or label skipped by deterministic detection', async () => {
    const infoLogs: unknown[][] = [];
    const logger: Logger = {
      ...noopLogger,
      info: (...args: unknown[]) => infoLogs.push(args),
    };
    const { ai, service } = setup(logger);
    await service.createConversation('01USER', { topic: 'music' });
    await collect(service.streamMessage('01USER', '01CONVERSATION', {
      content: 'She is "梁静茹".', clientRequestId: 'tool-detected-person-name',
    }));

    assert.deepEqual(ai.chatInputs[0].requiredExpressions, []);
    assert.equal(infoLogs.length, 1);
    assert.match(String(infoLogs[0][0]), /skipped person name or Chinese label/);
    assert.equal(infoLogs[0][1], '梁静茹');
    assert.equal(infoLogs.some(args => args.includes('She is "梁静茹".')), false);
  });

  it('passes the persisted summary into chat and persists summary.update without forwarding it', async () => {
    const { ai, repository, service } = setup();
    await service.createConversation('01USER', { topic: 'restaurant' });
    await repository.updateSummary('01CONVERSATION', '01USER', 'Old running summary.', 12);
    ai.summaryUpdate = { summary: 'New running summary.', foldedUntil: 20 };

    const learner = { displayName: '小明', englishLevel: 'B1' as const };
    const events = await collect(service.streamMessage(
      '01USER',
      '01CONVERSATION',
      { content: 'I like coffee.', clientRequestId: 'client-request-2' },
      learner,
    ));

    assert.equal(ai.chatInputs[0].summary, 'Old running summary.');
    assert.equal(ai.chatInputs[0].summaryFoldedUntil, 12);
    assert.ok(!events.some(event => event.type === 'summary.update'));
    const conversation = await repository.findByIdForUser('01CONVERSATION', '01USER');
    assert.equal(conversation?.summary, 'New running summary.');
    assert.equal(conversation?.summaryFoldedUntil, 20);
  });
});
