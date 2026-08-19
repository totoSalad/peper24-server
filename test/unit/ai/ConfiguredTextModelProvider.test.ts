import { strict as assert } from 'node:assert';
import { ConfiguredTextModelProvider } from '../../../app/module/ai/provider/ConfiguredTextModelProvider';
import { AppError } from '../../../app/module/system/error/AppError';

const ENV_KEYS = [
  'NODE_ENV',
  'AI_TEXT_PROVIDER',
  'DASHSCOPE_API_KEY',
  'BAILIAN_MODEL',
  'BAILIAN_TRANSLATION_MODEL',
  'BAILIAN_BASE_URL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODEL',
  'DEEPSEEK_BASE_URL',
] as const;

describe('ConfiguredTextModelProvider', () => {
  const originalEnv = Object.fromEntries(ENV_KEYS.map(key => [ key, process.env[key] ]));

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('rejects the removed development runtime provider', () => {
    process.env.AI_TEXT_PROVIDER = 'development';
    assert.throws(
      () => new ConfiguredTextModelProvider().resolve(),
      (error: unknown) => error instanceof AppError && error.code === 'AI_PROVIDER_INVALID',
    );
  });

  it('defaults production to DeepSeek while translation remains on Bailian', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AI_TEXT_PROVIDER;
    process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
    process.env.DASHSCOPE_API_KEY = 'bailian-test-key';

    const provider = new ConfiguredTextModelProvider();

    assert.equal(provider.resolve()?.provider, 'deepseek');
    assert.equal(provider.resolve()?.modelId, 'deepseek-chat');
    assert.equal(provider.resolve('translation')?.provider, 'bailian');
    assert.equal(provider.resolve('translation')?.modelId, 'qwen3.7-flash');
  });

  it('fails clearly instead of silently falling back when Bailian lacks a key', () => {
    process.env.AI_TEXT_PROVIDER = 'bailian';
    delete process.env.DASHSCOPE_API_KEY;

    assert.throws(
      () => new ConfiguredTextModelProvider().resolve(),
      (error: unknown) => error instanceof AppError && error.code === 'AI_PROVIDER_UNAVAILABLE',
    );
  });

  it('resolves the configured Bailian model without making a network request', () => {
    process.env.AI_TEXT_PROVIDER = 'bailian';
    process.env.DASHSCOPE_API_KEY = 'test-key';
    process.env.BAILIAN_MODEL = 'qwen-flash';
    process.env.BAILIAN_BASE_URL = 'https://example.com/compatible-mode/v1';

    const resolved = new ConfiguredTextModelProvider().resolve();

    assert.equal(resolved?.provider, 'bailian');
    assert.equal(resolved?.modelId, 'qwen-flash');
  });

  it('fails clearly instead of silently falling back when DeepSeek lacks a key', () => {
    process.env.AI_TEXT_PROVIDER = 'deepseek';
    delete process.env.DEEPSEEK_API_KEY;

    assert.throws(
      () => new ConfiguredTextModelProvider().resolve(),
      (error: unknown) => error instanceof AppError && error.code === 'AI_PROVIDER_UNAVAILABLE',
    );
  });

  it('resolves the configured DeepSeek model without making a network request', () => {
    process.env.AI_TEXT_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-chat';
    process.env.DEEPSEEK_BASE_URL = 'https://example.com';

    const resolved = new ConfiguredTextModelProvider().resolve();

    assert.equal(resolved?.provider, 'deepseek');
    assert.equal(resolved?.modelId, 'deepseek-chat');
  });

  it('uses Bailian qwen3.7-flash for translation while the default model remains DeepSeek', () => {
    process.env.AI_TEXT_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
    process.env.DASHSCOPE_API_KEY = 'bailian-test-key';

    const provider = new ConfiguredTextModelProvider();
    const defaultModel = provider.resolve();
    const translationModel = provider.resolve('translation');

    assert.equal(defaultModel?.provider, 'deepseek');
    assert.equal(translationModel?.provider, 'bailian');
    assert.equal(translationModel?.modelId, 'qwen3.7-flash');
  });

  it('rejects an unknown provider', () => {
    process.env.AI_TEXT_PROVIDER = 'unknown';

    assert.throws(
      () => new ConfiguredTextModelProvider().resolve(),
      (error: unknown) => error instanceof AppError && error.code === 'AI_PROVIDER_INVALID',
    );
    assert.throws(
      () => new ConfiguredTextModelProvider().resolve('translation'),
      (error: unknown) => error instanceof AppError && error.code === 'AI_PROVIDER_INVALID',
    );
  });
});
