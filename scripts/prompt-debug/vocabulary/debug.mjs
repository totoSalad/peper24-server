import 'dotenv/config';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { Output } from 'ai';

import { generateTextWithRetry } from '../../../app/module/ai/provider/AISDKTextGenerator.ts';
import { VocabularyEnrichmentSchema } from '../../../app/module/ai/schema/VocabularyEnrichmentSchema.ts';
import { vocabularyCases } from './cases.mjs';
import { vocabularyPromptVariants } from './prompts.mjs';

globalThis.AI_SDK_LOG_WARNINGS = false;

const reasoningStrengths = [ 'provider-default', 'low', 'none' ];

function valueAfter(argv, flag) {
  const equals = argv.find(value => value.startsWith(`${flag}=`));
  if (equals) return equals.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function positiveInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} 必须是正整数`);
  return parsed;
}

function parseArgs(argv) {
  return {
    caseIds: valueAfter(argv, '--case')?.split(',').filter(Boolean),
    variantIds: valueAfter(argv, '--variant')?.split(',').filter(Boolean),
    reasoningIds: valueAfter(argv, '--reasoning')?.split(',').filter(Boolean),
    runs: positiveInteger(valueAfter(argv, '--runs'), '--runs', 1),
    dryRun: argv.includes('--dry-run'),
    printPrompt: argv.includes('--print-prompt'),
    json: argv.includes('--json'),
  };
}

function selectById(items, requested, getId, label) {
  if (!requested) return items;
  const requestedSet = new Set(requested);
  const selected = items.filter(item => requestedSet.has(getId(item)));
  const found = new Set(selected.map(getId));
  const missing = requested.filter(id => !found.has(id));
  if (missing.length) throw new Error(`未知${label}: ${missing.join(', ')}`);
  return selected;
}

function normalize(value) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function evaluate(testCase, output) {
  const errors = [];
  const expected = testCase.expectation;
  const empty = Object.keys(output).length === 0;
  if (expected.empty) {
    if (!empty) errors.push('期望返回空对象（人名），实际返回了词汇详情');
    return errors;
  }
  if (empty) return [ '期望词汇详情，实际返回空对象' ];
  if (expected.enMeaning && !expected.enMeaning.test(output.enMeaning)) {
    errors.push(`enMeaning 不匹配 ${expected.enMeaning}: ${output.enMeaning}`);
  }
  if (expected.cnMeaning && !expected.cnMeaning.test(output.cnMeaning)) {
    errors.push(`cnMeaning 不匹配 ${expected.cnMeaning}: ${output.cnMeaning}`);
  }
  if (!normalize(output.example).includes(normalize(output.enMeaning))) {
    errors.push(`例句没有包含 enMeaning: ${output.enMeaning}`);
  }
  return errors;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [ ...values ].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
}

function summarize(results, configurations) {
  return configurations.map(({ variant, reasoning }) => {
    const rows = results.filter(item => item.variant === variant && item.reasoning === reasoning);
    const successful = rows.filter(item => item.callSucceeded);
    const durations = successful.map(item => item.durationMs);
    const passed = rows.filter(item => item.passed).length;
    const sum = values => values.reduce((total, value) => total + value, 0);
    return {
      variant,
      reasoning,
      description: vocabularyPromptVariants[variant].description,
      passed,
      total: rows.length,
      passRate: rows.length ? passed / rows.length : 0,
      averageMs: durations.length ? Math.round(sum(durations) / durations.length) : null,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      averageInputTokens: successful.length
        ? Math.round(sum(successful.map(item => item.inputTokens)) / successful.length)
        : null,
      averageOutputTokens: successful.length
        ? Math.round(sum(successful.map(item => item.outputTokens)) / successful.length)
        : null,
    };
  });
}

async function runOne(model, variantId, reasoning, testCase, run) {
  const startedAt = performance.now();
  try {
    const variant = vocabularyPromptVariants[variantId];
    const outputOption = variant.output === 'structured'
      ? Output.object({
        name: 'VocabularyEnrichment',
        description: 'Canonical learning information for one English word or short phrase.',
        schema: VocabularyEnrichmentSchema,
      })
      : Output.json();
    const result = await generateTextWithRetry({
      model,
      label: `vocabulary-benchmark:${variantId}:${reasoning}:${testCase.id}:${run}`,
      reasoning,
      ...(outputOption ? { output: outputOption } : {}),
      prompt: variant.build(testCase.input),
    });
    let output = result.output;
    if (variant.output === 'json-mode') {
      const parsed = VocabularyEnrichmentSchema.safeParse(result.output);
      if (!parsed.success) throw new Error(`JSON Mode 输出未通过 Zod: ${parsed.error.message}`);
      output = parsed.data;
    }
    const errors = evaluate(testCase, output);
    // 完整耗时包含模型生成、JSON 解析、对象组装及质量检查。
    const durationMs = Math.round(performance.now() - startedAt);
    return {
      variant: variantId,
      reasoning,
      caseId: testCase.id,
      run,
      callSucceeded: true,
      passed: errors.length === 0,
      durationMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      output,
      errors,
    };
  } catch (error) {
    return {
      variant: variantId,
      reasoning,
      caseId: testCase.id,
      run,
      callSucceeded: false,
      passed: false,
      durationMs: Math.round(performance.now() - startedAt),
      inputTokens: 0,
      outputTokens: 0,
      errors: [ error instanceof Error ? error.message : String(error) ],
    };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const allVariants = Object.keys(vocabularyPromptVariants);
  const cases = selectById(vocabularyCases, options.caseIds, item => item.id, '场景');
  const variantIds = selectById(allVariants, options.variantIds, item => item, ' Prompt 版本');
  const selectedReasoning = selectById(
    reasoningStrengths,
    options.reasoningIds ?? [ 'provider-default' ],
    item => item,
    '推理强度',
  );
  const configurations = variantIds.flatMap(variant => selectedReasoning.map(reasoning => ({
    variant, reasoning,
  })));

  if (options.printPrompt) {
    for (const variantId of variantIds) {
      for (const testCase of cases) {
        console.log(`\n===== ${variantId} / ${testCase.id} =====\n`);
        console.log(vocabularyPromptVariants[variantId].build(testCase.input));
      }
    }
  }
  if (options.dryRun) {
    console.log(`\n已检查 ${configurations.length} 个 Prompt/推理组合 × ${cases.length} 个场景；dry-run 未调用模型。`);
    return;
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('缺少 DEEPSEEK_API_KEY；可写入仓库根目录 .env，或使用 --dry-run');
  }

  const modelId = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
  const deepseek = createDeepSeek({
    apiKey: process.env.DEEPSEEK_API_KEY,
    ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}),
  });
  const model = deepseek(modelId);
  const results = [];

  // 每一轮交错运行各 Prompt/推理组合，降低服务端负载变化对单一组合的偏置。
  for (let run = 1; run <= options.runs; run++) {
    for (const testCase of cases) {
      const offset = (run - 1) % configurations.length;
      const order = [ ...configurations.slice(offset), ...configurations.slice(0, offset) ];
      for (const configuration of order) {
        const row = await runOne(
          model, configuration.variant, configuration.reasoning, testCase, run,
        );
        results.push(row);
        if (!options.json) {
          console.log(`${row.passed ? 'PASS' : 'FAIL'} ${row.variant.padEnd(9)} ${row.reasoning.padEnd(16)} ${testCase.id.padEnd(24)} #${run} ${row.durationMs}ms`);
          for (const error of row.errors) console.log(`  ! ${error}`);
        }
      }
    }
  }

  const summary = summarize(results, configurations);
  if (options.json) {
    console.log(JSON.stringify({ model: modelId, runs: options.runs, summary, results }, null, 2));
  } else {
    console.log(`\n词汇 Prompt 对比 · ${modelId}`);
    console.table(summary.map(item => ({
      variant: item.variant,
      reasoning: item.reasoning,
      quality: `${item.passed}/${item.total} (${Math.round(item.passRate * 100)}%)`,
      avg_ms: item.averageMs,
      p50_ms: item.p50Ms,
      p95_ms: item.p95Ms,
      input_tokens: item.averageInputTokens,
      output_tokens: item.averageOutputTokens,
    })));
  }

  if (results.some(item => !item.passed)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
