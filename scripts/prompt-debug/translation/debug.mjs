import 'dotenv/config';
import { createAlibaba } from '@ai-sdk/alibaba';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { Output } from 'ai';

import { generateTextWithRetry } from '../../../app/module/ai/provider/AISDKTextGenerator.ts';
import { buildTranslationPrompt } from '../../../app/module/ai/prompt/TranslationPrompt.ts';
import { TranslationOutputSchema } from '../../../app/module/ai/schema/TranslationSchema.ts';
import { translationCases } from './cases.mjs';

globalThis.AI_SDK_LOG_WARNINGS = false;

const REASONING = 'none';
const comparisonTargets = [
  { id: 'deepseek-flash', provider: 'deepseek', modelId: 'deepseek-v4-flash' },
  { id: 'qwen3.7-flash', provider: 'bailian', modelId: 'qwen3.7-flash' },
];

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
    targetIds: valueAfter(argv, '--target')?.split(',').filter(Boolean),
    runs: positiveInteger(valueAfter(argv, '--runs'), '--runs', 2),
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

function evaluate(testCase, translation) {
  const errors = [];
  for (const pattern of testCase.expectation.mustMatch ?? []) {
    if (!pattern.test(translation)) errors.push(`译文未匹配 ${pattern}: ${translation}`);
  }
  for (const pattern of testCase.expectation.mustNotMatch ?? []) {
    if (pattern.test(translation)) errors.push(`译文包含禁止内容 ${pattern}: ${translation}`);
  }
  const lineCount = translation.split(/\r?\n/).length;
  if (testCase.expectation.minimumLineCount && lineCount < testCase.expectation.minimumLineCount) {
    errors.push(`译文应至少保留 ${testCase.expectation.minimumLineCount} 行，实际 ${lineCount} 行`);
  }
  return errors;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [ ...values ].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
}

function summarize(results, targets) {
  return targets.map(target => {
    const rows = results.filter(item => item.variant === target.id);
    const successful = rows.filter(item => item.callSucceeded);
    const durations = successful.map(item => item.durationMs);
    const passed = rows.filter(item => item.passed).length;
    const sum = values => values.reduce((total, value) => total + value, 0);
    return {
      ...target,
      reasoning: REASONING,
      passed,
      total: rows.length,
      passRate: rows.length ? passed / rows.length : 0,
      callSucceeded: successful.length,
      callSuccessRate: rows.length ? successful.length / rows.length : 0,
      averageMs: durations.length ? Math.round(sum(durations) / durations.length) : null,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      minMs: durations.length ? Math.min(...durations) : null,
      maxMs: durations.length ? Math.max(...durations) : null,
      averageInputTokens: successful.length
        ? Math.round(sum(successful.map(item => item.inputTokens)) / successful.length)
        : null,
      averageOutputTokens: successful.length
        ? Math.round(sum(successful.map(item => item.outputTokens)) / successful.length)
        : null,
    };
  });
}

async function runOne(model, target, testCase, run) {
  const startedAt = performance.now();
  try {
    const result = await generateTextWithRetry({
      model,
      label: `translation-benchmark:${target.id}:${REASONING}:${testCase.id}:${run}`,
      reasoning: REASONING,
      output: Output.object({
        name: 'MessageTranslation',
        description: 'A faithful translation of one chat message.',
        schema: TranslationOutputSchema,
      }),
      prompt: buildTranslationPrompt(testCase.input),
    });
    const errors = evaluate(testCase, result.output.translation);
    const durationMs = Math.round(performance.now() - startedAt);
    return {
      variant: target.id,
      provider: target.provider,
      modelId: target.modelId,
      reasoning: REASONING,
      caseId: testCase.id,
      run,
      callSucceeded: true,
      passed: errors.length === 0,
      durationMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      output: result.output,
      errors,
    };
  } catch (error) {
    return {
      variant: target.id,
      provider: target.provider,
      modelId: target.modelId,
      reasoning: REASONING,
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

function createTargetModel(target) {
  if (target.provider === 'deepseek') {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error('缺少 DEEPSEEK_API_KEY；可写入仓库根目录 .env，或用 --target qwen3.7-flash');
    }
    const deepseek = createDeepSeek({
      apiKey: process.env.DEEPSEEK_API_KEY,
      ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}),
    });
    return deepseek(target.modelId);
  }
  if (!process.env.DASHSCOPE_API_KEY) {
    throw new Error('缺少 DASHSCOPE_API_KEY；可写入仓库根目录 .env，或用 --target deepseek-flash');
  }
  const bailian = createAlibaba({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: process.env.BAILIAN_BASE_URL
      ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });
  return bailian(target.modelId);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cases = selectById(translationCases, options.caseIds, item => item.id, '场景');
  const targets = selectById(comparisonTargets, options.targetIds, item => item.id, '模型目标');

  if (options.printPrompt) {
    for (const testCase of cases) {
      console.log(`\n===== ${testCase.id} =====\n`);
      console.log(buildTranslationPrompt(testCase.input));
    }
  }
  if (options.dryRun) {
    const totalCalls = targets.length * cases.length * options.runs;
    console.log(`\n已检查 ${targets.length} 个模型目标 × ${cases.length} 个场景 × ${options.runs} 轮 = ${totalCalls} 次调用；reasoning=${REASONING}；dry-run 未调用模型。`);
    return;
  }

  const models = new Map(targets.map(target => [ target.id, createTargetModel(target) ]));
  const results = [];
  for (let run = 1; run <= options.runs; run++) {
    for (const testCase of cases) {
      const offset = (run - 1) % targets.length;
      const order = [ ...targets.slice(offset), ...targets.slice(0, offset) ];
      for (const target of order) {
        const row = await runOne(models.get(target.id), target, testCase, run);
        results.push(row);
        if (!options.json) {
          console.log(`${row.passed ? 'PASS' : 'FAIL'} ${row.variant.padEnd(18)} ${row.provider.padEnd(10)} ${row.reasoning.padEnd(6)} ${testCase.id.padEnd(24)} #${run} ${row.durationMs}ms`);
          for (const error of row.errors) console.log(`  ! ${error}`);
        }
      }
    }
  }

  const summary = summarize(results, targets);
  if (options.json) {
    console.log(JSON.stringify({ targets, reasoning: REASONING, runs: options.runs, summary, results }, null, 2));
  } else {
    console.log('\n翻译模型对比 · Structured Output');
    console.table(summary.map(item => ({
      target: item.id,
      provider: item.provider,
      model: item.modelId,
      reasoning: item.reasoning,
      quality: `${item.passed}/${item.total} (${Math.round(item.passRate * 100)}%)`,
      calls: `${item.callSucceeded}/${item.total} (${Math.round(item.callSuccessRate * 100)}%)`,
      avg_ms: item.averageMs,
      p50_ms: item.p50Ms,
      p95_ms: item.p95Ms,
      min_ms: item.minMs,
      max_ms: item.maxMs,
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
