import { strict as assert } from 'node:assert';
import type { LanguageModel } from 'ai';
import { Output } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { generateTextWithRetry } from '../../../app/module/ai/provider/AISDKTextGenerator';
import { TranslationOutputSchema } from '../../../app/module/ai/schema/TranslationSchema';

const translation = '我想要一杯咖啡。';
const jsonTranslation = JSON.stringify({ translation });

function generateResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: {
      inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 8, text: 8, reasoning: undefined },
    },
    warnings: [],
  };
}

function mockModel(outputs: string[]): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    provider: 'mock-provider',
    modelId: 'mock-chat',
    doGenerate: outputs.map(generateResult),
  });
}

const structuredTranslationOutput = Output.object({
  name: 'MessageTranslation',
  description: 'A faithful translation of one chat message.',
  schema: TranslationOutputSchema,
});

describe('translation output format comparison', () => {
  it('produces the same business translation with less response framing as plain text', async () => {
    const jsonModel = mockModel([ jsonTranslation ]);
    const textModel = mockModel([ translation ]);

    const jsonResult = await generateTextWithRetry({
      model: jsonModel as LanguageModel,
      prompt: 'Translate the message.',
      output: structuredTranslationOutput,
    });
    const textResult = await generateTextWithRetry({
      model: textModel as LanguageModel,
      prompt: 'Translate the message.',
    });

    assert.equal(jsonResult.output.translation, textResult.text);
    assert.equal(jsonModel.doGenerateCalls.length, 1);
    assert.equal(textModel.doGenerateCalls.length, 1);
    assert.ok(jsonTranslation.length > translation.length);
  });

  it('retries malformed JSON while plain text completes in one model call', async () => {
    const jsonModel = mockModel([ 'not valid json', jsonTranslation ]);
    const textModel = mockModel([ translation ]);

    const jsonResult = await generateTextWithRetry({
      model: jsonModel as LanguageModel,
      prompt: 'Translate the message.',
      output: structuredTranslationOutput,
    });
    const textResult = await generateTextWithRetry({
      model: textModel as LanguageModel,
      prompt: 'Translate the message.',
    });

    assert.equal(jsonResult.output.translation, textResult.text);
    assert.equal(jsonModel.doGenerateCalls.length, 2);
    assert.equal(textModel.doGenerateCalls.length, 1);
  });
});
