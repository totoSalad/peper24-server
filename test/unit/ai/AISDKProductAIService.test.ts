import { strict as assert } from 'node:assert';
import { Logger } from '@eggjs/tegg';
import type { LanguageModel } from 'ai';
import { APICallError, simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { AISDKProductAIService } from '../../../app/module/ai/provider/AISDKProductAIService';
import {
  ResolvedTextModel,
  TextModelPurpose,
  TextModelProvider,
} from '../../../app/module/ai/provider/TextModelProvider';

class StaticTextModelProvider extends TextModelProvider {
  readonly requestedPurposes: TextModelPurpose[] = [];

  constructor(private readonly resolved: ResolvedTextModel) {
    super();
  }

  resolve(purpose: TextModelPurpose = 'default'): ResolvedTextModel {
    this.requestedPurposes.push(purpose);
    return this.resolved;
  }
}

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

describe('AISDKProductAIService', () => {
  it('streams AI SDK text parts and converts final usage to product events', async () => {
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'Hello ' },
            { type: 'text-delta', id: 'text-1', delta: 'there!' },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: { total: 7, noCache: 7, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 5, text: 5, reasoning: undefined },
              },
            },
          ],
        }),
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel,
      provider: 'mock-provider',
      modelId: 'mock-chat',
    }), noopLogger);

    const events = await collect(service.chat({
      messageId: '01MESSAGE',
      userId: '01USER',
      conversationId: '01CONVERSATION',
      topic: 'Coffee',
      history: [],
      content: 'I like coffee.',
      learner: { englishLevel: 'B1' },
    }));

    assert.deepEqual(events.map(event => event.type), [
      'message.start',
      'message.delta',
      'message.delta',
      'message.done',
    ]);
    assert.deepEqual(events.at(-1), {
      type: 'message.done',
      messageId: '01MESSAGE',
      usage: {
        provider: 'mock-provider',
        model: 'mock-chat',
        inputTokens: 7,
        outputTokens: 5,
      },
    });
  });

  it('parses schema-validated grammar analysis from structured model output', async () => {
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              explicitGrammarQuestion: false,
              errors: [
                {
                  errorType: 'tense',
                  original: 'Yesterday I go home.',
                  corrected: 'Yesterday I went home.',
                  note: '过去发生的事情使用过去式。',
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel,
      provider: 'mock-provider',
      modelId: 'mock-chat',
    }), noopLogger);

    const result = await service.analyzeGrammar({
      content: 'Yesterday I go home.',
      learner: { englishLevel: 'A2' },
    });

    assert.equal(result.explicitGrammarQuestion, false);
    assert.equal(result.errors[0].errorType, 'tense');
    assert.equal(result.errors[0].corrected, 'Yesterday I went home.');
  });

  it('parses schema-validated vocabulary enrichment', async () => {
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cnMeaning: '全麦面包', enMeaning: 'whole wheat bread',
            example: 'I bought whole wheat bread.',
            phonetic: '/hoʊl wiːt bred/',
          }),
        }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 10, text: 10, reasoning: undefined },
        },
        warnings: [],
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel, provider: 'mock-provider', modelId: 'mock-chat',
    }), noopLogger);
    const result = await service.enrichVocabulary({
      text: 'whole wheat bread', context: 'I bought whole wheat bread.',
    });
    assert.ok(result);
    assert.equal(result.cnMeaning, '全麦面包');
    assert.equal(result.enMeaning, 'whole wheat bread');
    assert.equal(
      (model.doGenerateCalls[0] as unknown as { reasoning?: string }).reasoning,
      'none',
    );
  });

  it('maps an empty vocabulary enrichment object for a person name to null', async () => {
    const model = new MockLanguageModelV3({
      provider: 'mock-provider', modelId: 'mock-chat',
      doGenerate: {
        content: [{ type: 'text', text: '{}' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel, provider: 'mock-provider', modelId: 'mock-chat',
    }), noopLogger);

    assert.equal(await service.enrichVocabulary({
      text: '梁静茹', context: 'I listened to 梁静茹 yesterday.',
    }), null);
    assert.equal(
      (model.doGenerateCalls[0] as unknown as { reasoning?: string }).reasoning,
      'provider-default',
    );
  });

  it('returns a plain-text message translation', async () => {
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: {
        content: [{ type: 'text', text: '  我想要一杯咖啡。  ' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 8, text: 8, reasoning: undefined },
        },
        warnings: [],
      },
    });
    const provider = new StaticTextModelProvider({
      model: model as LanguageModel, provider: 'mock-provider', modelId: 'mock-chat',
    });
    const service = new AISDKProductAIService(provider, noopLogger);
    const result = await service.translate({
      content: 'I would like a coffee.', targetLanguage: 'Chinese',
    });
    assert.deepEqual(result, { translation: '我想要一杯咖啡。' });
    assert.equal(model.doGenerateCalls.length, 1);
  });

  it('returns a schema-validated daily learning summary with usage', async () => {
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: {
        content: [{
          type: 'text', text: JSON.stringify({
            headline: '今天保持了练习',
            highlights: [ '完成一次对话' ],
            improvements: [ '继续注意时态' ],
            nextSteps: [ '复习新增表达' ],
          }),
        }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 12, text: 12, reasoning: undefined },
        },
        warnings: [],
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel, provider: 'mock-provider', modelId: 'mock-chat',
    }), noopLogger);

    const result = await service.generateDailyLearningSummary({
      date: '2026-08-11', timezone: 'Asia/Shanghai',
      metrics: {
        conversationCount: 1, userMessageCount: 3, chatTokens: 200,
        grammarErrorCount: 1, grammar: [], newVocabularyCount: 1,
        newVocabulary: [ 'almost late' ], reviewedCount: 0,
        reviewResults: { again: 0, hard: 0, good: 0, easy: 0 },
      },
    });

    assert.equal(result.content.headline, '今天保持了练习');
    assert.deepEqual(result.usage, {
      provider: 'mock-provider', model: 'mock-chat', inputTokens: 20, outputTokens: 12,
    });
  });

  it('returns up to two schema-validated final memory admission decisions', async () => {
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            decisions: [{
              shouldSave: true, layer: 'long_term', type: 'preference',
              summary: 'Enjoys weekend hiking', normalizedKey: 'weekend-hobby',
              sourceMessageIds: [ '01MESSAGE' ],
              scores: { futureValue: 2, personalImportance: 1, explicitness: 2 },
              penalties: [], explicitRemember: false, inferredOrHypothetical: false,
              containsSecret: false, reason: 'Stable hobby',
            }, {
              shouldSave: true, layer: 'long_term', type: 'profile',
              summary: 'Lives in Beijing', normalizedKey: 'home-city',
              sourceMessageIds: [ '01MESSAGE' ],
              scores: { futureValue: 2, personalImportance: 1, explicitness: 2 },
              penalties: [], explicitRemember: false, inferredOrHypothetical: false,
              containsSecret: false, reason: 'Stable profile',
            }],
          }),
        }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 8, text: 8, reasoning: undefined },
        },
        warnings: [],
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel, provider: 'mock-provider', modelId: 'mock-chat',
    }), noopLogger);
    const result = await service.extractMemories({
      targetMessageIds: [ '01MESSAGE' ],
      messages: [{ id: '01MESSAGE', role: 'user', content: '我喜欢周末徒步。' }],
      existingMemories: [],
    });
    assert.deepEqual(result.decisions.map(decision => decision.shouldSave && decision.normalizedKey),
      [ 'weekend-hobby', 'home-city' ]);
    assert.deepEqual(result.decisions[0].shouldSave && result.decisions[0].sourceMessageIds,
      [ '01MESSAGE' ]);
  });

  it('retries rate-limit failures (429) then succeeds', async () => {
    let attempts = 0;
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: async () => {
        attempts++;
        if (attempts === 1) {
          throw new APICallError({
            message: 'rate limit exceeded',
            url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
            requestBodyValues: {},
            statusCode: 429,
          });
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ explicitGrammarQuestion: false, errors: [] }),
          }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel, provider: 'mock-provider', modelId: 'mock-chat',
    }), noopLogger);

    const result = await service.analyzeGrammar({ content: 'She like music.' });

    assert.equal(result.explicitGrammarQuestion, false);
    assert.equal(attempts, 2);
  });

  it('retries connection-reset (ECONNRESET) failures then succeeds', async () => {
    let attempts = 0;
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: async () => {
        attempts++;
        if (attempts === 1) {
          throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ explicitGrammarQuestion: false, errors: [] }),
          }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel, provider: 'mock-provider', modelId: 'mock-chat',
    }), noopLogger);

    const result = await service.analyzeGrammar({ content: 'She like music.' });

    assert.equal(result.explicitGrammarQuestion, false);
    assert.equal(attempts, 2);
  });

  it('does not retry non-transient failures', async () => {
    let attempts = 0;
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: async () => {
        attempts++;
        throw new Error('invalid input');
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel, provider: 'mock-provider', modelId: 'mock-chat',
    }), noopLogger);

    await assert.rejects(service.analyzeGrammar({ content: 'She like music.' }), /invalid input/);

    assert.equal(attempts, 1);
  });

  it('fails fast when Retry-After exceeds the 5s cap', async () => {
    let attempts = 0;
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: async () => {
        attempts++;
        throw new APICallError({
          message: 'rate limit exceeded',
          url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
          requestBodyValues: {},
          statusCode: 429,
          responseHeaders: { 'retry-after': '120' },
        });
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel, provider: 'mock-provider', modelId: 'mock-chat',
    }), noopLogger);

    await assert.rejects(service.analyzeGrammar({ content: 'She like music.' }), /rate limit/);

    assert.equal(attempts, 1);
  });

  it('honours Retry-After within the 5s cap when retrying', async () => {
    let attempts = 0;
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: async () => {
        attempts++;
        if (attempts === 1) {
          throw new APICallError({
            message: 'rate limit exceeded',
            url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
            requestBodyValues: {},
            statusCode: 429,
            responseHeaders: { 'retry-after': '1' },
          });
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ explicitGrammarQuestion: false, errors: [] }),
          }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel, provider: 'mock-provider', modelId: 'mock-chat',
    }), noopLogger);

    const result = await service.analyzeGrammar({ content: 'She like music.' });

    assert.equal(result.explicitGrammarQuestion, false);
    assert.equal(attempts, 2);
  });

  it('folds over-budget history, summarizes the folded messages, and streams the window', async () => {
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: {
        content: [{ type: 'text', text: 'Earlier you talked about coffee.' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 6, text: 6, reasoning: undefined },
        },
        warnings: [],
      },
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'Ok, ' },
            { type: 'text-delta', id: 'text-1', delta: 'got it.' },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            },
          ],
        }),
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel, provider: 'mock-provider', modelId: 'mock-chat',
    }), noopLogger);

    // 300 条 × ~60 tokens = ~18K，超过软预算 12K → 折叠到最近 30 条窗口。
    const history = Array.from({ length: 300 }, (_, index) => ({
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${index}:` + 'x'.repeat(236),
    }));
    const events = await collect(service.chat({
      messageId: '01MESSAGE',
      userId: '01USER',
      conversationId: '01CONVERSATION',
      topic: 'Coffee',
      history,
      content: 'I like coffee.',
      learner: { englishLevel: 'B1' },
    }));

    assert.equal(model.doStreamCalls.length, 1);
    assert.equal(model.doGenerateCalls.length, 1);
    // 折叠消息经 LLM 摘要后以 summary.update 事件交给调用方持久化。
    const summaryUpdate = events.find(event => event.type === 'summary.update');
    assert.ok(summaryUpdate?.type === 'summary.update');
    assert.equal(summaryUpdate.summary, 'Earlier you talked about coffee.');
    assert.equal(summaryUpdate.foldedUntil, 271);
    // 折叠时把新摘要注入 system prompt。
    const system = model.doStreamCalls[0].prompt.find(message => message.role === 'system');
    assert.ok(system?.role === 'system' && system.content.includes('Earlier you talked about coffee.'));
    // prompt 以 system 消息开头，之后才是折叠后的聊天消息窗口。
    const sent = model.doStreamCalls[0].prompt.filter(message => message.role !== 'system');
    assert.ok(sent.length <= 30);
    assert.equal(sent.at(-1)?.role, 'user');
    // SDK 把文本内容规范化为 content parts。
    assert.deepEqual(sent.at(-1)?.content, [{ type: 'text', text: 'I like coffee.' }]);
  });

  it('only summarizes newly folded messages beyond the persisted frontier', async () => {
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: {
        content: [{ type: 'text', text: 'Incremental summary.' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 6, text: 6, reasoning: undefined },
        },
        warnings: [],
      },
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'ok' },
            { type: 'text-end', id: 'text-1' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } } },
          ],
        }),
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel, provider: 'mock-provider', modelId: 'mock-chat',
    }), noopLogger);

    const history = Array.from({ length: 300 }, (_, index) => ({
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${index}:` + 'x'.repeat(236),
    }));
    await collect(service.chat({
      messageId: '01MESSAGE', userId: '01USER', conversationId: '01CONVERSATION',
      topic: 'Coffee', history, content: 'I like coffee.',
      summary: 'Already covered up to message 200.',
      summaryFoldedUntil: 200,
    }));

    // 折叠到 271 条，但只有 [200, 271) 是新折叠段，交给摘要。
    assert.equal(model.doGenerateCalls.length, 1);
    const summarizePrompt = model.doGenerateCalls[0].prompt
      .filter(message => message.role !== 'system')
      .map(message => {
        if (!('content' in message) || !Array.isArray(message.content)) return '';
        return message.content.map(part => {
          return 'text' in part ? part.text : '';
        }).join('');
      })
      .join('\n');
    assert.match(summarizePrompt, /m205:/);
    assert.doesNotMatch(summarizePrompt, /m100:/);
  });

  it('injects the persisted summary without summarizing when nothing is folded', async () => {
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'hi' },
            { type: 'text-end', id: 'text-1' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } } },
          ],
        }),
      },
    });
    const service = new AISDKProductAIService(new StaticTextModelProvider({
      model: model as LanguageModel, provider: 'mock-provider', modelId: 'mock-chat',
    }), noopLogger);

    const events = await collect(service.chat({
      messageId: '01MESSAGE', userId: '01USER', conversationId: '01CONVERSATION',
      topic: 'Coffee',
      history: [
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
      ],
      content: 'Hello there.',
      summary: 'Existing running summary.',
      summaryFoldedUntil: 0,
    }));

    assert.equal(model.doGenerateCalls.length, 0);
    assert.ok(!events.some(event => event.type === 'summary.update'));
    const system = model.doStreamCalls[0].prompt.find(message => message.role === 'system');
    assert.ok(system?.role === 'system' && system.content.includes('Existing running summary.'));
  });
});
