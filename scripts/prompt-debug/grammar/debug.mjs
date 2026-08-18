import 'dotenv/config';
import { createAlibaba } from '@ai-sdk/alibaba';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { Output } from 'ai';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { generateTextWithRetry } from '../../../app/module/ai/provider/AISDKTextGenerator.ts';
import { grammarCases } from './cases.mjs';
import { grammarPromptVariants } from './prompts.mjs';
import { buildReportData } from './report.mjs';
import { GrammarAnalysisBenchmarkSchema } from './schema.mjs';

globalThis.AI_SDK_LOG_WARNINGS = false;

const REASONING = 'none';
const comparisonTargets = [
  { id: 'deepseek-flash', provider: 'deepseek', modelId: 'deepseek-v4-flash' },
  { id: 'qwen-flash', provider: 'bailian', modelId: 'qwen-flash' },
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
    promptIds: valueAfter(argv, '--prompt')?.split(',').filter(Boolean),
    runs: positiveInteger(valueAfter(argv, '--runs'), '--runs', 2),
    dryRun: argv.includes('--dry-run'),
    printPrompt: argv.includes('--print-prompt'),
    json: argv.includes('--json'),
    outputPath: valueAfter(argv, '--output'),
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
  return value.normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

function evaluate(testCase, output) {
  const errors = [];
  const expected = testCase.expectation;
  if (output.explicitGrammarQuestion !== expected.explicitGrammarQuestion) {
    errors.push(`explicitGrammarQuestion 应为 ${expected.explicitGrammarQuestion}，实际为 ${output.explicitGrammarQuestion}`);
  }

  const actualTypes = output.errors.map(item => item.errorType);
  for (const required of expected.requiredTypes ?? []) {
    if (!actualTypes.includes(required)) errors.push(`缺少错误类型 ${required}`);
  }
  const allowed = new Set(expected.allowedTypes ?? expected.requiredTypes ?? []);
  for (const actual of actualTypes) {
    if (!allowed.has(actual)) errors.push(`出现非预期错误类型 ${actual}`);
  }

  const corrected = output.errors.map(item => item.corrected).join('\n');
  for (const pattern of expected.correctedMustMatch ?? []) {
    if (!pattern.test(corrected)) errors.push(`纠正结果未匹配 ${pattern}: ${corrected}`);
  }

  const input = normalize(testCase.input.content);
  for (const item of output.errors) {
    if (!input.includes(normalize(item.original))) {
      errors.push(`original 不是输入中的原文片段: ${item.original}`);
    }
    if (normalize(item.original) === normalize(item.corrected)) {
      errors.push(`corrected 未改变原文: ${item.original}`);
    }
    if (!/[\u3400-\u9fff]/u.test(item.note)) {
      errors.push(`note 应为中文: ${item.note}`);
    }
  }
  return errors;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [ ...values ].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
}

function summarize(results, variants) {
  return variants.map(variant => {
    const rows = results.filter(item => item.variant === variant.id);
    const successful = rows.filter(item => item.callSucceeded);
    const durations = successful.map(item => item.durationMs);
    const passed = rows.filter(item => item.passed).length;
    const sum = values => values.reduce((total, value) => total + value, 0);
    return {
      ...variant,
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

async function runOne(model, variant, testCase, run) {
  const startedAt = performance.now();
  let structuredRepairRetries = 0;
  const logger = {
    info() {},
    warn() { structuredRepairRetries += 1; },
  };
  try {
    const result = await generateTextWithRetry({
      model,
      logger,
      label: `grammar-benchmark:${variant.id}:${REASONING}:${testCase.id}:${run}`,
      reasoning: REASONING,
      output: Output.object({
        name: 'GrammarAnalysis',
        description: 'Fixed-taxonomy English grammar analysis for one learner message.',
        schema: GrammarAnalysisBenchmarkSchema,
      }),
      prompt: variant.buildPrompt(testCase.input),
    });
    const output = result.output;
    const errors = evaluate(testCase, output);
    const durationMs = Math.round(performance.now() - startedAt);
    return {
      variant: variant.id,
      targetId: variant.targetId,
      promptId: variant.promptId,
      provider: variant.provider,
      modelId: variant.modelId,
      reasoning: REASONING,
      caseId: testCase.id,
      caseDescription: testCase.description,
      inputContent: testCase.input.content,
      expectation: {
        explicitGrammarQuestion: testCase.expectation.explicitGrammarQuestion,
        requiredTypes: testCase.expectation.requiredTypes ?? [],
        allowedTypes: testCase.expectation.allowedTypes ?? testCase.expectation.requiredTypes ?? [],
      },
      run,
      callSucceeded: true,
      passed: errors.length === 0,
      durationMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      structuredRepairRetries,
      output,
      errors,
    };
  } catch (error) {
    return {
      variant: variant.id,
      targetId: variant.targetId,
      promptId: variant.promptId,
      provider: variant.provider,
      modelId: variant.modelId,
      reasoning: REASONING,
      caseId: testCase.id,
      caseDescription: testCase.description,
      inputContent: testCase.input.content,
      expectation: {
        explicitGrammarQuestion: testCase.expectation.explicitGrammarQuestion,
        requiredTypes: testCase.expectation.requiredTypes ?? [],
        allowedTypes: testCase.expectation.allowedTypes ?? testCase.expectation.requiredTypes ?? [],
      },
      run,
      callSucceeded: false,
      passed: false,
      durationMs: Math.round(performance.now() - startedAt),
      inputTokens: 0,
      outputTokens: 0,
      structuredRepairRetries,
      errors: [ error instanceof Error ? error.message : String(error) ],
    };
  }
}

function createTargetModel(target) {
  if (target.provider === 'deepseek') {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error('缺少 DEEPSEEK_API_KEY；可写入仓库根目录 .env，或用 --target qwen-flash');
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
  const cases = selectById(grammarCases, options.caseIds, item => item.id, '场景');
  const targets = selectById(comparisonTargets, options.targetIds, item => item.id, '模型目标');
  const prompts = selectById(grammarPromptVariants, options.promptIds, item => item.id, 'Prompt');
  const variants = targets.flatMap(target => prompts.map(prompt => ({
    id: `${target.id}:${prompt.id}`,
    targetId: target.id,
    promptId: prompt.id,
    provider: target.provider,
    modelId: target.modelId,
    buildPrompt: prompt.build,
  })));

  if (options.printPrompt) {
    for (const prompt of prompts) {
      for (const testCase of cases) {
        console.log(`\n===== ${prompt.id} / ${testCase.id} =====\n`);
        console.log(prompt.build(testCase.input));
      }
    }
  }
  if (options.dryRun) {
    const totalCalls = targets.length * prompts.length * cases.length * options.runs;
    console.log(`\n已检查 ${targets.length} 个模型目标 × ${prompts.length} 个 Prompt × ${cases.length} 个场景 × ${options.runs} 轮 = ${totalCalls} 次调用；reasoning=${REASONING}；dry-run 未调用模型。`);
    return;
  }

  const models = new Map(targets.map(target => [ target.id, createTargetModel(target) ]));
  const results = [];
  for (let run = 1; run <= options.runs; run++) {
    for (const testCase of cases) {
      const offset = (run - 1) % variants.length;
      const order = [ ...variants.slice(offset), ...variants.slice(0, offset) ];
      for (const variant of order) {
        const row = await runOne(models.get(variant.targetId), variant, testCase, run);
        results.push(row);
        if (!options.json) {
          console.log(`${row.passed ? 'PASS' : 'FAIL'} ${row.variant.padEnd(34)} ${row.provider.padEnd(10)} ${row.reasoning.padEnd(6)} ${testCase.id.padEnd(28)} #${run} ${row.durationMs}ms`);
          for (const error of row.errors) console.log(`  ! ${error}`);
        }
      }
    }
  }

  const summary = summarize(results, variants);
  const promptDefinitions = prompts.map(({ id, description }) => ({ id, description }));
  const payload = { targets, prompts: promptDefinitions, reasoning: REASONING, runs: options.runs, summary, results };
  payload.report = buildReportData(payload);
  if (options.outputPath) {
    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`\n逐次结果已写入 ${options.outputPath}`);
  } else if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('\n语法分析模型对比 · Structured Output');
    console.table(summary.map(item => ({
      target: item.id,
      prompt: item.promptId,
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
