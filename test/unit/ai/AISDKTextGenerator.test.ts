import { strict as assert } from 'node:assert';
import { Logger } from '@eggjs/tegg';
import { type LanguageModel, NoObjectGeneratedError, Output } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { generateTextWithRetry } from '../../../app/module/ai/provider/AISDKTextGenerator';
import { VocabularyEnrichmentSchema } from '../../../app/module/ai/schema/VocabularyEnrichmentSchema';

const noopLogger: Logger = {
  debug() {},
  log() {},
  info() {},
  warn() {},
  error() {},
};

const validVocabularyJson = JSON.stringify({
  cnMeaning: '全麦面包',
  enMeaning: 'whole wheat bread',
  example: 'I bought whole wheat bread.',
  phonetic: '/hoʊl wiːt bred/',
});

function generateResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
    warnings: [],
  };
}

const vocabularyOutput = Output.object({
  name: 'VocabularyEnrichment',
  description: 'Canonical learning information for one English word or short phrase.',
  schema: VocabularyEnrichmentSchema,
});

describe('generateTextWithRetry', () => {
  it('repairs malformed structured output once and returns the parsed object', async () => {
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: [
        generateResult('not valid json'),
        generateResult(validVocabularyJson),
      ],
    });

    const result = await generateTextWithRetry({
      model: model as LanguageModel,
      prompt: 'Enrich the word.',
      output: vocabularyOutput,
      logger: noopLogger,
      label: 'enrichVocabulary',
    });

    assert.equal(model.doGenerateCalls.length, 2);
    assert.equal(result.output.cnMeaning, '全麦面包');
    assert.equal(result.output.enMeaning, 'whole wheat bread');
    // The repair call must carry the failure detail so the model can fix its JSON.
    assert.ok(
      JSON.stringify(model.doGenerateCalls[1].prompt).includes('could not be parsed'),
      'second attempt should receive the repair prompt',
    );
  });

  it('repairs only once and rejects when the repair is also malformed', async () => {
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: [
        generateResult('still not json'),
        generateResult('still not json'),
      ],
    });

    await assert.rejects(
      generateTextWithRetry({
        model: model as LanguageModel,
        prompt: 'Enrich the word.',
        output: vocabularyOutput,
        logger: noopLogger,
        label: 'enrichVocabulary',
      }),
      (error: unknown) => NoObjectGeneratedError.isInstance(error),
    );
    assert.equal(model.doGenerateCalls.length, 2);
  });

  it('passes plain text through unchanged when no structured output is requested', async () => {
    const model = new MockLanguageModelV3({
      provider: 'mock-provider',
      modelId: 'mock-chat',
      doGenerate: [ generateResult('Hello there!') ],
    });

    const result = await generateTextWithRetry({
      model: model as LanguageModel,
      prompt: 'Say hi.',
      logger: noopLogger,
      label: 'createWelcome',
    });

    assert.equal(model.doGenerateCalls.length, 1);
    assert.equal(result.text, 'Hello there!');
  });
});
