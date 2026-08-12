import { strict as assert } from 'node:assert';
import { DeepSeekTextModelProvider } from '../../../app/module/ai/provider/DeepSeekTextModelProvider';
import { AppError } from '../../../app/module/system/error/AppError';

describe('DeepSeekTextModelProvider', () => {
  const originalProvider = process.env.AI_TEXT_PROVIDER;
  const originalApiKey = process.env.DEEPSEEK_API_KEY;
  const originalModel = process.env.DEEPSEEK_MODEL;

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.AI_TEXT_PROVIDER;
    else process.env.AI_TEXT_PROVIDER = originalProvider;
    if (originalApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = originalModel;
  });

  it('returns no external model when development mode is explicit', () => {
    process.env.AI_TEXT_PROVIDER = 'development';
    assert.equal(new DeepSeekTextModelProvider().resolve(), null);
  });

  it('fails clearly instead of silently falling back when DeepSeek lacks a key', () => {
    process.env.AI_TEXT_PROVIDER = 'deepseek';
    delete process.env.DEEPSEEK_API_KEY;

    assert.throws(
      () => new DeepSeekTextModelProvider().resolve(),
      (error: unknown) => error instanceof AppError && error.code === 'AI_PROVIDER_UNAVAILABLE',
    );
  });

  it('resolves the configured DeepSeek model without making a network request', () => {
    process.env.AI_TEXT_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-chat';

    const resolved = new DeepSeekTextModelProvider().resolve();

    assert.equal(resolved?.provider, 'deepseek');
    assert.equal(resolved?.modelId, 'deepseek-chat');
  });
});
