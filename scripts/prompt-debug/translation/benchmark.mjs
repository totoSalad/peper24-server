import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { Output } from 'ai';

import { buildTranslationPrompt } from '../../../app/module/ai/prompt/TranslationPrompt.ts';
import { generateTextWithRetry } from '../../../app/module/ai/provider/AISDKTextGenerator.ts';
import { TranslationOutputSchema } from '../../../app/module/ai/schema/TranslationSchema.ts';
import { evaluateTranslationCase, translationCases } from './cases.mjs';

globalThis.AI_SDK_LOG_WARNINGS = false;

const variants = {
  json: {
    description: 'Schema structured output returning { translation }',
    prompt: input => [
      'Translate the message faithfully and naturally.',
      `Target language: ${input.targetLanguage}.`,
      'Preserve meaning, tone, names, numbers, and formatting.',
      'Return only the structured translation requested by the schema.',
      '<message>',
      JSON.stringify({ content: input.content }),
      '</message>',
    ].join('\n'),
    output: Output.object({
      name: 'MessageTranslation',
      description: 'A faithful translation of one chat message.',
      schema: TranslationOutputSchema,
    }),
    value: result => result.output.translation,
  },
  'text-baseline': {
    description: 'Original plain-text prompt with a JSON-wrapped source message',
    prompt: input => [
      'Translate the message faithfully and naturally.',
      `Target language: ${input.targetLanguage}.`,
      'Preserve meaning, tone, names, numbers, and formatting.',
      'Return only the translated message, without explanations, labels, or quotation marks.',
      '<message>',
      JSON.stringify({ content: input.content }),
      '</message>',
    ].join('\n'),
    value: result => result.text.trim(),
  },
  'text-optimized': {
    description: 'Optimized bare-text contract with raw source boundaries',
    prompt: input => buildTranslationPrompt(input),
    value: result => result.text.trim(),
  },
};

function valueAfter(argv, flag) {
  const equals = argv.find(value => value.startsWith(`${flag}=`));
  if (equals) return equals.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('--runs 必须是正整数');
  return parsed;
}

function instrumentModel(model) {
  let calls = 0;
  const instrumented = new Proxy(model, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === 'doGenerate') {
        return async (...args) => {
          calls++;
          return value.apply(target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { model: instrumented, calls: () => calls };
}

async function runOne(baseModel, variantId, reasoning, testCase, run) {
  const variant = variants[variantId];
  const observed = instrumentModel(baseModel);
  const startedAt = performance.now();
  try {
    const result = await generateTextWithRetry({
      model: observed.model,
      label: `translation-benchmark:${variantId}:${reasoning}:${testCase.id}:${run}`,
      reasoning,
      ...(variant.output ? { output: variant.output } : {}),
      prompt: variant.prompt(testCase.input),
    });
    const output = variant.value(result);
    const errors = evaluateTranslationCase(testCase, output);
    return {
      variant: variantId,
      reasoning,
      caseId: testCase.id,
      caseDescription: testCase.description,
      input: testCase.input,
      run,
      callSucceeded: true,
      passed: errors.length === 0,
      durationMs: Math.round(performance.now() - startedAt),
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      modelCalls: observed.calls(),
      retries: Math.max(0, observed.calls() - 1),
      output,
      errors,
      errorCategories: errors.length ? [ '业务语义错误' ] : [],
    };
  } catch (error) {
    return {
      variant: variantId,
      reasoning,
      caseId: testCase.id,
      caseDescription: testCase.description,
      input: testCase.input,
      run,
      callSucceeded: false,
      passed: false,
      durationMs: Math.round(performance.now() - startedAt),
      inputTokens: 0,
      outputTokens: 0,
      modelCalls: observed.calls(),
      retries: Math.max(0, observed.calls() - 1),
      errors: [ error instanceof Error ? error.message : String(error) ],
      errorCategories: [ '调用失败' ],
    };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const runs = positiveInteger(valueAfter(argv, '--runs'), 10);
  const outputName = valueAfter(argv, '--output') ?? 'translation-output-format.json';
  const requestedVariants = valueAfter(argv, '--variant')?.split(',').filter(Boolean);
  const reasoningIds = valueAfter(argv, '--reasoning')?.split(',').filter(Boolean)
    ?? [ 'provider-default' ];
  const supportedReasoning = new Set([ 'provider-default', 'none' ]);
  const unknownReasoning = reasoningIds.filter(id => !supportedReasoning.has(id));
  if (unknownReasoning.length) {
    throw new Error(`未知 reasoning: ${unknownReasoning.join(', ')}`);
  }
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('缺少 DEEPSEEK_API_KEY');

  const modelId = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
  const deepseek = createDeepSeek({
    apiKey: process.env.DEEPSEEK_API_KEY,
    ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}),
  });
  const model = deepseek(modelId);
  const results = [];
  const variantIds = requestedVariants ?? Object.keys(variants);
  const unknownVariants = variantIds.filter(id => !variants[id]);
  if (unknownVariants.length) throw new Error(`未知 variant: ${unknownVariants.join(', ')}`);
  const configurations = variantIds.flatMap(variant => reasoningIds.map(reasoning => ({
    variant, reasoning,
  })));

  for (let run = 1; run <= runs; run++) {
    for (const testCase of translationCases) {
      const offset = (run - 1) % configurations.length;
      const order = [ ...configurations.slice(offset), ...configurations.slice(0, offset) ];
      for (const configuration of order) {
        const row = await runOne(
          model, configuration.variant, configuration.reasoning, testCase, run,
        );
        results.push(row);
        console.log(`${row.passed ? 'PASS' : 'FAIL'} ${configuration.reasoning.padEnd(16)} ${testCase.id.padEnd(22)} #${String(run).padStart(2)} ${row.durationMs}ms calls=${row.modelCalls}`);
      }
    }
  }

  const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
  await fs.mkdir(directory, { recursive: true });
  const outputPath = path.join(directory, outputName);
  await fs.writeFile(outputPath, `${JSON.stringify({
    title: '翻译 JSON 与纯文本输出对比',
    experiment: {
      model: modelId,
      runs,
      reasoning: reasoningIds,
      variants: Object.fromEntries(Object.entries(variants).map(([ id, item ]) => [
        id, { description: item.description },
      ])),
      execution: '按轮次交错执行，端到端计时包含生成、解析、校验与业务断言',
    },
    cases: translationCases.map(({ id, description, input }) => ({ id, description, input })),
    results,
  }, null, 2)}\n`, 'utf8');
  console.log(`RESULT ${outputPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
