import { strict as assert } from 'node:assert';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModel } from 'ai';
import {
  estimateTokens,
  PromptContextCompressor,
  PromptMessage,
} from '../../../app/module/ai/provider/PromptContextCompressor';

// content ≈ 60 tokens each: 4-char label + 236 filler chars (~60 ASCII tokens).
function messages(count: number, label = 'm'): PromptMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${label}${index}:` + 'x'.repeat(236),
  }));
}

function testModel(text = 'test summary') {
  return new MockLanguageModelV3({
    provider: 'test-provider',
    modelId: 'test-chat',
    doGenerate: {
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

function compressor(overrides: Partial<{
  softBudgetTokens: number;
  hardCapTokens: number;
  maxMessages: number;
  maxMessageTokens: number;
  model: LanguageModel;
}> = {}) {
  return new PromptContextCompressor({
    softBudgetTokens: 1000,
    hardCapTokens: 800,
    maxMessages: 30,
    maxMessageTokens: 2000,
    model: testModel() as unknown as LanguageModel,
    ...overrides,
  });
}

describe('estimateTokens', () => {
  it('counts roughly one token per 4 ASCII characters', () => {
    assert.equal(estimateTokens('hello world'), 3);
  });

  it('counts roughly one token per CJK character', () => {
    assert.equal(estimateTokens('你好世界'), 4);
  });

  it('handles mixed text and empty input', () => {
    assert.equal(estimateTokens('你好hello'), 4);
    assert.equal(estimateTokens(''), 0);
  });
});

describe('PromptContextCompressor', () => {
  it('returns messages unchanged when within the soft budget', async () => {
    const result = await compressor().compress([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);

    assert.equal(result.compressed, false);
    assert.equal(result.folded, 0);
    assert.equal(result.messages.length, 2);
    assert.deepEqual(result.foldedMessages, []);
    assert.equal(result.summary, undefined);
    assert.equal(result.summaryFoldedUntil, 0);
  });

  it('never folds a single message, even far beyond the budget', async () => {
    const result = await compressor({ softBudgetTokens: 10, hardCapTokens: 10 }).compress([
      { role: 'user', content: 'x'.repeat(4000) },
    ]);

    assert.equal(result.compressed, false);
    assert.equal(result.folded, 0);
    assert.equal(result.messages.length, 1);
  });

  describe('完整对话边界对齐', () => {
    it('keeps [a2,u2,a3] from [a1,u1,a2,u2,a3] when max is 4', async () => {
      const source: PromptMessage[] = [
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a2' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a3' },
      ];
      const result = await compressor({
        softBudgetTokens: 4,
        hardCapTokens: 100,
        maxMessages: 4,
      }).compress(source);

      assert.equal(result.compressed, true);
      assert.equal(result.folded, 2);
      assert.equal(result.summary, 'test summary');
      assert.equal(result.summaryFoldedUntil, 2);
      assert.deepEqual(result.messages, source.slice(2));
      assert.deepEqual(result.foldedMessages, source.slice(0, 2));
    });

    it('never splits a (assistant → user) pair when trimming by count', async () => {
      // 50 × 60 = 3000 > 1000 → over soft; aligned cut keeps 29 (not 30).
      const source = messages(50);
      const result = await compressor({ hardCapTokens: 100_000 }).compress(source);

      assert.equal(result.compressed, true);
      assert.equal(result.folded, 21);
      assert.equal(result.messages.length, 29);
      assert.equal(result.messages[0].content, source[21].content);
      assert.equal(result.messages.at(-1)?.content, source[49].content);
      assert.deepEqual(result.foldedMessages.map(m => m.content), source.slice(0, 21).map(m => m.content));
    });

    it('keeps a trailing assistant message as its own complete unit', async () => {
      const source: PromptMessage[] = [
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a2' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a3' },
      ];
      // max 3: aligned suffix ≤ 3 is [a2,u2,a3]; [u1,a2,u2] would split pair (a1,u1).
      const result = await compressor({
        softBudgetTokens: 4,
        hardCapTokens: 100,
        maxMessages: 3,
      }).compress(source);

      assert.equal(result.folded, 2);
      assert.deepEqual(result.messages, source.slice(2));
    });

    it('keeps consecutive user messages together with their assistant when ordering is noisy', async () => {
      // 网络抖动导致 a1 后连续到达 u1、u2：[a1,u1,u2] 是一个完整对话单元，不能从 u2 处切开。
      const source: PromptMessage[] = [
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
      ];
      // max=2：唯一合法的对齐后缀是 [a2]；[u1,u2,a2] 或 [u2,a2] 都会拆开 [a1,u1,u2]。
      const result = await compressor({
        softBudgetTokens: 3,
        hardCapTokens: 100,
        maxMessages: 2,
      }).compress(source);

      assert.equal(result.compressed, true);
      assert.equal(result.folded, 3);
      assert.deepEqual(result.messages, source.slice(3));
      assert.deepEqual(result.foldedMessages, source.slice(0, 3));
    });
  });

  describe('硬上限兜底', () => {
    it('folds oldest-first until the kept window fits the hard cap', async () => {
      // 50 × 60 = 3000 > 1000 → over soft; 29 × 60 = 1740 > 800 → keeps folding.
      const source = messages(50);
      const result = await compressor().compress(source);

      assert.equal(result.compressed, true);
      assert.equal(result.folded, 50 - result.messages.length);
      // 最后 13 条（60 × 13 = 780 ≤ 800）被保留，其余最旧优先折叠。
      assert.equal(result.messages.length, 13);
      assert.equal(result.messages[0].content, source[37].content);
      assert.equal(result.messages.at(-1)?.content, source[49].content);
    });

    it('keeps folding past the hard cap and never drops the last message', async () => {
      const source = messages(40);
      const result = await compressor({ hardCapTokens: 50 }).compress(source);

      assert.equal(result.compressed, true);
      assert.equal(result.messages.length, 1);
      assert.equal(result.folded, 39);
      assert.equal(result.messages[0].content, source[39].content);
    });

    it('keeps the current user message and its assistant turn as the hard-cap floor', async () => {
      // 真实对话结构：末尾是当前用户消息，边界规则下最少保留最后一条 (assistant, user) 完整对话。
      const source: PromptMessage[] = [];
      for (let index = 0; index < 20; index += 1) {
        source.push({ role: 'assistant', content: `a${index}:` + 'x'.repeat(236) });
        source.push({ role: 'user', content: `u${index}:` + 'x'.repeat(236) });
      }
      const result = await compressor({ hardCapTokens: 50 }).compress(source);

      assert.equal(result.messages.length, 2);
      assert.equal(result.messages.at(-1), source.at(-1));
      assert.equal(result.messages[0], source[source.length - 2]);
    });
  });

  describe('单条超阈值裁剪', () => {
    it('trims an over-threshold message to keep front 60% + back 40%, dropping the middle', async () => {
      const maxMessageTokens = 100;
      const source = { role: 'user' as const, content: 'A'.repeat(300) + 'B'.repeat(300) };
      const result = await compressor({ maxMessageTokens, softBudgetTokens: 100_000, hardCapTokens: 100_000 })
        .compress([ source ]);

      assert.equal(result.compressed, true);
      assert.equal(result.folded, 0);
      const trimmed = result.messages[0].content;
      // 前 60%×100 = 60 token ≈ 240 ASCII 字符，后 40%×100 = 40 token ≈ 160 字符。
      assert.ok(trimmed.startsWith('A'.repeat(240)));
      assert.ok(trimmed.endsWith('B'.repeat(160)));
      assert.ok(trimmed.includes(' … '));
      assert.ok(estimateTokens(trimmed) <= maxMessageTokens + 2);
    });

    it('leaves under-threshold messages untouched', async () => {
      const source = { role: 'user' as const, content: 'x'.repeat(80) };
      const result = await compressor({ maxMessageTokens: 100, softBudgetTokens: 100_000, hardCapTokens: 100_000 })
        .compress([ source ]);

      assert.equal(result.compressed, false);
      assert.equal(result.messages[0].content, source.content);
    });
  });

  describe('running summary', () => {
    it('only summarizes newly folded messages beyond the persisted frontier', async () => {
      const model = testModel('new summary');
      const source = messages(50);
      const result = await compressor({
        hardCapTokens: 100_000,
        model: model as unknown as LanguageModel,
      }).compress(source, {
        previousSummary: 'old summary',
        summaryFoldedUntil: 10,
      });

      assert.equal(result.summary, 'new summary');
      assert.equal(result.summaryFoldedUntil, 21);
      assert.equal(model.doGenerateCalls.length, 1);
      const prompt = model.doGenerateCalls[0].prompt
        .filter(message => message.role !== 'system')
        .map(message => {
          if (!('content' in message) || !Array.isArray(message.content)) return '';
          return message.content.map(part => {
            return 'text' in part ? part.text : '';
          }).join('');
        })
        .join('\n');
      assert.match(prompt, /m10:/);
      assert.doesNotMatch(prompt, /m9:/);
    });

    it('keeps the previous summary and frontier when summarizing fails', async () => {
      const model = new MockLanguageModelV3({
        provider: 'test-provider',
        modelId: 'test-chat',
        doGenerate: async () => { throw new Error('boom'); },
      });
      const source = messages(50);
      const result = await compressor({
        hardCapTokens: 100_000,
        model: model as unknown as LanguageModel,
      }).compress(source, {
        previousSummary: 'old summary',
        summaryFoldedUntil: 10,
      });

      assert.equal(result.summary, 'old summary');
      assert.equal(result.summaryFoldedUntil, 10);
      assert.equal(model.doGenerateCalls.length, 1);
      assert.ok(result.messages.length > 0);
    });

    it('carries the previous summary through without summarizing when nothing folds', async () => {
      const result = await compressor({ softBudgetTokens: 100_000, hardCapTokens: 100_000 }).compress([
        { role: 'user', content: 'hi' },
      ], {
        previousSummary: 'existing summary',
        summaryFoldedUntil: 3,
      });

      assert.equal(result.compressed, false);
      assert.equal(result.summary, 'existing summary');
      assert.equal(result.summaryFoldedUntil, 3);
    });
  });
});
