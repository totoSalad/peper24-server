import { strict as assert } from 'node:assert';
import { TranslationService, translationTarget } from '../../../app/module/conversation/service/TranslationService';
import { AppError } from '../../../app/module/system/error/AppError';
import { FakeClock } from '../../support/fake/AccountFakes';
import { FakeProductAIService, InMemoryConversationRepository } from '../../support/fake/ConversationFakes';

describe('TranslationService', () => {
  const now = new Date('2026-08-06T04:00:00.000Z');

  function setup(content = 'I would like a coffee.') {
    const repository = new InMemoryConversationRepository();
    repository.conversations.push({
      id: '01CONVERSATION', userId: '01USER', topic: 'Coffee', status: 'active',
      nextMessageSequence: 2,
      createdAt: now, updatedAt: now,
    });
    repository.messages.push({
      id: '01MESSAGE', conversationId: '01CONVERSATION', role: 'assistant',
      status: 'completed', content, sequence: 1, createdAt: now, updatedAt: now,
    });
    const ai = new FakeProductAIService();
    const service = new TranslationService(repository, ai, new FakeClock(now));
    return { repository, ai, service };
  }

  it('chooses the opposite target language from the message content', () => {
    assert.equal(translationTarget('I like coffee.'), 'Chinese');
    assert.equal(translationTarget('我喜欢咖啡。'), 'English');
  });

  it('translates an owned completed message and caches the result', async () => {
    const { ai, service } = setup();
    const first = await service.translateMessage('01USER', '01MESSAGE');
    const cached = await service.translateMessage('01USER', '01MESSAGE');
    assert.deepEqual(first, { translation: '这是一条翻译。' });
    assert.deepEqual(cached, first);
    assert.equal(ai.translationCalls, 1);
    assert.equal(ai.translationInputs[0].targetLanguage, 'Chinese');
  });

  it('coalesces concurrent requests for the same message', async () => {
    const { ai, service } = setup();
    const [ first, second ] = await Promise.all([
      service.translateMessage('01USER', '01MESSAGE'),
      service.translateMessage('01USER', '01MESSAGE'),
    ]);
    assert.deepEqual(first, second);
    assert.equal(ai.translationCalls, 1);
  });

  it('does not expose another user message or save an AI failure', async () => {
    const { repository, ai, service } = setup();
    await assert.rejects(
      service.translateMessage('01OTHER', '01MESSAGE'),
      (error: unknown) => error instanceof AppError && error.code === 'MESSAGE_NOT_FOUND',
    );
    ai.translationFailure = new Error('provider failed');
    await assert.rejects(
      service.translateMessage('01USER', '01MESSAGE'),
      (error: unknown) => error instanceof AppError && error.code === 'TRANSLATION_FAILED',
    );
    assert.equal(repository.messages[0].translation, undefined);
  });
});
