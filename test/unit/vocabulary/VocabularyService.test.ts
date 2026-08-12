import { strict as assert } from 'node:assert';
import type { Logger } from '@eggjs/tegg';
import { AppError } from '../../../app/module/system/error/AppError';
import { scheduleReview } from '../../../app/module/vocabulary/service/ReviewScheduler';
import { isEnglishExpression, normalizeExpression, VocabularyService } from '../../../app/module/vocabulary/service/VocabularyService';
import { FakeClock, FixedIdGenerator } from '../../support/fake/AccountFakes';
import { FakeProductAIService } from '../../support/fake/ConversationFakes';
import { InMemoryVocabularyRepository } from '../../support/fake/VocabularyFakes';

const noopLogger: Logger = {
  debug() {},
  log() {},
  info() {},
  warn() {},
  error() {},
};

describe('VocabularyService', () => {
  const now = new Date('2026-08-06T01:00:00.000Z');

  function setup(logger: Logger = noopLogger) {
    const repository = new InMemoryVocabularyRepository();
    repository.sources.set('01MESSAGE', {
      userId: '01USER',
      message: { id: '01MESSAGE', content: 'I bought whole   wheat bread today.' },
    });
    const ai = new FakeProductAIService();
    const service = new VocabularyService(
      repository,
      ai,
      new FixedIdGenerator([ '01VOCAB', '01CONTEXT', '02VOCAB', '02CONTEXT', '01LOG', '02LOG' ]),
      new FakeClock(now),
      logger,
    );
    return { repository, ai, service };
  }

  it('normalizes Unicode, whitespace, and case', () => {
    assert.equal(normalizeExpression('  Ｗhole   Wheat Bread  '), 'whole wheat bread');
  });

  it('enriches a selected expression and creates an immediately due vocabulary', async () => {
    const { repository, service } = setup();
    const item = await service.addFromSelection('01USER', 'whole   wheat bread', '01MESSAGE');
    assert.ok(item);
    assert.equal(item.normalizedExpression, 'whole wheat bread');
    assert.equal(repository.items[0].reviewState.nextReviewAt.toISOString(), now.toISOString());
    assert.equal(repository.contexts.length, 1);
  });

  it('deduplicates a canonical expression and does not duplicate the same message context', async () => {
    const { repository, service } = setup();
    await service.addFromSelection('01USER', 'whole   wheat bread', '01MESSAGE');
    await service.addFromSelection('01USER', 'Whole Wheat Bread', '01MESSAGE');
    assert.equal(repository.items.length, 1);
    assert.equal(repository.contexts.length, 1);
  });

  it('rejects a source message owned by someone else or text absent from the source', async () => {
    const { service } = setup();
    await assert.rejects(
      service.addFromSelection('01OTHER', 'whole wheat bread', '01MESSAGE'),
      (error: unknown) => error instanceof AppError && error.code === 'MESSAGE_NOT_FOUND',
    );
    await assert.rejects(
      service.addFromSelection('01USER', 'coffee', '01MESSAGE'),
      (error: unknown) => error instanceof AppError && error.code === 'EXPRESSION_NOT_IN_MESSAGE',
    );
  });

  it('treats Latin script as English and CJK as not English', () => {
    assert.equal(isEnglishExpression('chewy'), true);
    assert.equal(isEnglishExpression('soothing, rhythmic pace'), true);
    assert.equal(isEnglishExpression('Actually, I really want to try mixed noodles.'), true);
    assert.equal(isEnglishExpression('有嚼劲'), false);
    assert.equal(isEnglishExpression('差点迟到'), false);
    assert.equal(isEnglishExpression('提拉米苏'), false);
  });

  it('keeps an English input as the saved expression', async () => {
    const { service } = setup();
    const result = await service.enrichExpression('chewy', 'context');
    assert.equal(result?.expression, 'chewy');
  });

  it('converts a Chinese expression to English via enMeaning and saves the English word', async () => {
    const { repository, ai, service } = setup();
    repository.sources.set('01CN', {
      userId: '01USER',
      message: { id: '01CN', content: '这个菜很有嚼劲。' },
    });
    ai.vocabularyEnrichment = {
      cnMeaning: '有嚼劲', enMeaning: 'chewy',
      example: 'These noodles are chewy.', phonetic: '/tʃuːi/',
    };
    const item = await service.addFromSelection('01USER', '有嚼劲', '01CN');
    assert.ok(item);
    assert.equal(item.expression, 'chewy');
    assert.equal(repository.items[0].expression, 'chewy');
  });

  it('silently skips a person name when enrichment returns no value', async () => {
    const infoLogs: unknown[][] = [];
    const logger: Logger = {
      ...noopLogger,
      info: (...args: unknown[]) => infoLogs.push(args),
    };
    const { repository, ai, service } = setup(logger);
    repository.sources.set('01NAME', {
      userId: '01USER', message: { id: '01NAME', content: 'She is "梁静茹".' },
    });
    ai.vocabularyEnrichment = null;

    assert.equal(await service.enrichExpression('梁静茹', 'She is "梁静茹".'), null);
    assert.equal(await service.addFromSelection('01USER', '梁静茹', '01NAME'), null);
    assert.equal(repository.items.length, 0);
    assert.equal(infoLogs.length, 2);
    assert.match(String(infoLogs[0][0]), /skipped empty result, likely person name/);
    assert.equal(infoLogs[0][1], '梁静茹');
    assert.equal(infoLogs.some(args => args.includes('She is "梁静茹".')), false);
  });

  it('rejects a Chinese input whose enMeaning is still not English', async () => {
    const { ai, service } = setup();
    ai.vocabularyEnrichment = {
      cnMeaning: '有嚼劲', enMeaning: '还是中文',
      example: 'x', phonetic: '/x/',
    };
    await assert.rejects(
      service.enrichExpression('有嚼劲', 'context'),
      (error: unknown) => error instanceof AppError && error.code === 'VOCABULARY_ENRICHMENT_FAILED',
    );
  });

  it('rejects an over-long enMeaning that reads like a definition', async () => {
    const { ai, service } = setup();
    ai.vocabularyEnrichment = {
      cnMeaning: '提拉米苏',
      enMeaning: 'A popular Italian dessert made with coffee-soaked ladyfingers and mascarpone cheese and cocoa powder.',
      example: 'x', phonetic: '/x/',
    };
    await assert.rejects(
      service.enrichExpression('提拉米苏', 'context'),
      (error: unknown) => error instanceof AppError && error.code === 'VOCABULARY_ENRICHMENT_FAILED',
    );
  });

  it('surfaces enrichment failure without a duplicate AI call and saves nothing', async () => {
    const { repository, ai, service } = setup();
    ai.vocabularyFailure = new Error('invalid output');
    await assert.rejects(
      service.addFromSelection('01USER', 'whole wheat bread', '01MESSAGE'),
      (error: unknown) => error instanceof AppError
        && error.code === 'VOCABULARY_ENRICHMENT_FAILED',
    );
    assert.equal(ai.vocabularyCalls, 1);
    assert.equal(repository.items.length, 0);
  });

  it('maps result actions to server scores and replays duplicate requests', async () => {
    const { repository, service } = setup();
    await service.addFromSelection('01USER', 'whole wheat bread', '01MESSAGE');
    const first = await service.answer('01USER', '01VOCAB', 'good', 'request-1');
    const replay = await service.answer('01USER', '01VOCAB', 'easy', 'request-1');
    assert.equal(first.score, 3);
    assert.deepEqual(replay, first);
    assert.equal(repository.reviews.size, 1);
  });

  it('caps the due queue at ten', async () => {
    const { repository, service } = setup();
    for (let index = 0; index < 12; index += 1) {
      repository.items.push({
        id: `v${index}`, userId: '01USER', originalExpression: `word${index}`,
        expression: `word${index}`, normalizedExpression: `word${index}`,
        detail: { cnMeaning: '词', enMeaning: `word${index}`, example: 'Example.', phonetic: '/w/' },
        lastEncounteredAt: now, createdAt: now, updatedAt: now,
        reviewState: {
          vocabularyId: `v${index}`, repetitions: 0, intervalDays: 0,
          easinessFactor: 2.5, nextReviewAt: now, updatedAt: now,
        },
      });
    }
    assert.equal((await service.listDue('01USER', 100)).length, 10);
  });
});

describe('scheduleReview', () => {
  const reviewedAt = new Date('2026-08-06T00:00:00.000Z');
  const state = {
    vocabularyId: 'v1', repetitions: 0, intervalDays: 0,
    easinessFactor: 2.5, nextReviewAt: reviewedAt, updatedAt: reviewedAt,
  };

  it('uses one day, six days, then the previous interval times EF', () => {
    const first = scheduleReview(state, 5, reviewedAt);
    const second = scheduleReview(first, 5, reviewedAt);
    const third = scheduleReview(second, 5, reviewedAt);
    assert.equal(first.intervalDays, 1);
    assert.equal(second.intervalDays, 6);
    assert.equal(third.intervalDays, 16);
  });

  it('resets failures to one day and never lowers EF below 1.3', () => {
    let current = { ...state, repetitions: 4, intervalDays: 30, easinessFactor: 1.3 };
    current = scheduleReview(current, 0, reviewedAt);
    assert.equal(current.repetitions, 0);
    assert.equal(current.intervalDays, 1);
    assert.equal(current.easinessFactor, 1.3);
  });
});
