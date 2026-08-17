import 'dotenv/config';
import { createAlibaba } from '@ai-sdk/alibaba';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { generateText, Output } from 'ai';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { buildConversationSystemPrompt } from '../../../app/module/ai/prompt/ConversationPrompt.ts';
import { generateTextWithRetry } from '../../../app/module/ai/provider/AISDKTextGenerator.ts';
import { conversationCases } from './cases.mjs';
import {
  buildJudgePrompt,
  buildConversationRubricSchema,
  passedRubric,
  totalScore,
} from './rubric.ts';

globalThis.AI_SDK_LOG_WARNINGS = false;

const modelTargets = [
  { id: 'deepseek', provider: 'deepseek', modelId: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat' },
  { id: 'qwen', provider: 'bailian', modelId: process.env.BAILIAN_MODEL ?? 'qwen3.7-flash' },
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

function findById(items, id, label) {
  const item = items.find(candidate => candidate.id === id);
  if (!item) throw new Error(`未知${label}: ${id}`);
  return item;
}

function selectCases(requested) {
  if (!requested) return conversationCases;
  return requested.split(',').filter(Boolean).map(id => findById(conversationCases, id, '场景'));
}

function createModel(target) {
  if (target.provider === 'deepseek') {
    if (!process.env.DEEPSEEK_API_KEY) throw new Error('缺少 DEEPSEEK_API_KEY');
    const provider = createDeepSeek({
      apiKey: process.env.DEEPSEEK_API_KEY,
      ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}),
    });
    return provider(target.modelId);
  }
  if (!process.env.DASHSCOPE_API_KEY) throw new Error('缺少 DASHSCOPE_API_KEY');
  const provider = createAlibaba({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: process.env.BAILIAN_BASE_URL
      ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });
  return provider(target.modelId);
}

async function generateCandidate(model, testCase) {
  const result = await generateText({
    model,
    system: buildConversationSystemPrompt({
      topic: testCase.topic,
      scene: testCase.scene,
      learner: testCase.learner,
    }),
    messages: testCase.messages,
    maxRetries: 0,
  });
  const output = result.text.trim();
  if (!output) throw new Error('主对话模型返回了空文本');
  return {
    output,
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
  };
}

async function judgeCandidate(model, testCase, candidateOutput) {
  const result = await generateTextWithRetry({
    model,
    label: `conversation-rubric:${testCase.id}`,
    reasoning: 'none',
    output: Output.object({
      name: 'ConversationRubricEvaluation',
      description: 'Three 0-2 rubric scores and a concise evidence-based reason.',
      schema: buildConversationRubricSchema(candidateOutput),
    }),
    prompt: buildJudgePrompt(testCase, candidateOutput),
  });
  return {
    rubric: result.output,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const cases = selectCases(valueAfter(argv, '--case'));
  const candidateTarget = findById(
    modelTargets,
    valueAfter(argv, '--candidate') ?? 'deepseek',
    '候选模型',
  );
  const judgeTarget = findById(
    modelTargets,
    valueAfter(argv, '--judge') ?? 'qwen',
    'Judge 模型',
  );
  const runs = positiveInteger(valueAfter(argv, '--runs'), '--runs', 1);
  const dryRun = argv.includes('--dry-run');
  const printPrompt = argv.includes('--print-prompt');
  const json = argv.includes('--json');
  const outputPath = valueAfter(argv, '--output');
  const rejudgePath = valueAfter(argv, '--rejudge');

  if (printPrompt) {
    for (const testCase of cases) {
      console.log(`\n===== ${testCase.id} · system =====\n`);
      console.log(buildConversationSystemPrompt(testCase));
      console.log(`\n===== ${testCase.id} · messages =====\n`);
      console.log(JSON.stringify(testCase.messages, null, 2));
    }
  }
  if (dryRun) {
    console.log(`已检查 ${cases.length} 个多轮场景 × ${runs} 轮；候选=${candidateTarget.id}，Judge=${judgeTarget.id}；dry-run 未调用模型。`);
    return;
  }

  const judgeModel = createModel(judgeTarget);
  const results = [];
  if (rejudgePath) {
    const source = JSON.parse(await readFile(rejudgePath, 'utf8'));
    if (!Array.isArray(source.results)) throw new Error('--rejudge 文件缺少 results 数组');
    const selectedIds = new Set(cases.map(testCase => testCase.id));
    for (const sourceRow of source.results.filter(row => selectedIds.has(row.caseId))) {
      const testCase = findById(cases, sourceRow.caseId, '场景');
      if (typeof sourceRow.output !== 'string' || !sourceRow.output.trim()) {
        throw new Error(`--rejudge 的 ${sourceRow.caseId} #${sourceRow.run} 缺少候选输出`);
      }
      const startedAt = performance.now();
      try {
        const judged = await judgeCandidate(judgeModel, testCase, sourceRow.output);
        const judgeDurationMs = Math.round(performance.now() - startedAt);
        const score = totalScore(judged.rubric);
        const passed = passedRubric(judged.rubric);
        const row = {
          variant: `${judgeTarget.id}-grounded-judge`,
          reasoning: 'judge-none',
          caseId: testCase.id,
          caseDescription: testCase.description,
          input: testCase.messages,
          run: sourceRow.run,
          callSucceeded: true,
          passed,
          score,
          durationMs: Math.round(performance.now() - startedAt),
          candidateDurationMs: 0,
          judgeDurationMs,
          inputTokens: judged.inputTokens,
          outputTokens: judged.outputTokens,
          candidate: sourceRow.candidate ?? candidateTarget,
          judge: judgeTarget,
          output: sourceRow.output,
          previousRubric: sourceRow.rubric,
          rubric: judged.rubric,
          errors: passed ? [] : [ judged.rubric.reason ],
          errorCategories: passed ? [] : [ 'rubric_failure' ],
          usage: {
            candidateInputTokens: 0,
            candidateOutputTokens: 0,
            judgeInputTokens: judged.inputTokens,
            judgeOutputTokens: judged.outputTokens,
          },
        };
        results.push(row);
        if (!json) {
          console.log(`${passed ? 'PASS' : 'FAIL'} ${testCase.id.padEnd(28)} #${sourceRow.run} ${score}/6 ${row.durationMs}ms`);
          console.log(`  output: ${sourceRow.output}`);
          console.log(`  rubric: context=${judged.rubric.contextualCoherence}, natural=${judged.rubric.naturalness}, continue=${judged.rubric.encouragesContinuation}`);
          console.log(`  reason: ${judged.rubric.reason}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          variant: `${judgeTarget.id}-grounded-judge`,
          reasoning: 'judge-none',
          caseId: testCase.id,
          caseDescription: testCase.description,
          input: testCase.messages,
          run: sourceRow.run,
          callSucceeded: false,
          passed: false,
          score: 0,
          durationMs: Math.round(performance.now() - startedAt),
          inputTokens: 0,
          outputTokens: 0,
          candidate: candidateTarget,
          judge: judgeTarget,
          error: message,
          errors: [ message ],
          errorCategories: [ 'call_failure' ],
        });
        if (!json) console.log(`FAIL ${testCase.id.padEnd(28)} #${sourceRow.run} error: ${message}`);
      }
    }
  } else {
    const candidateModel = createModel(candidateTarget);
    for (let run = 1; run <= runs; run++) {
      for (const testCase of cases) {
        const startedAt = performance.now();
        try {
          const candidateStartedAt = performance.now();
          const candidate = await generateCandidate(candidateModel, testCase);
          const candidateDurationMs = Math.round(performance.now() - candidateStartedAt);
          const judgeStartedAt = performance.now();
          const judged = await judgeCandidate(judgeModel, testCase, candidate.output);
          const judgeDurationMs = Math.round(performance.now() - judgeStartedAt);
          const score = totalScore(judged.rubric);
          const passed = passedRubric(judged.rubric);
          const row = {
            variant: `${candidateTarget.id}->${judgeTarget.id}`,
            reasoning: 'candidate-default+judge-none',
            caseId: testCase.id,
            caseDescription: testCase.description,
            input: testCase.messages,
            run,
            callSucceeded: true,
            passed,
            score,
            durationMs: Math.round(performance.now() - startedAt),
            candidateDurationMs,
            judgeDurationMs,
            inputTokens: candidate.inputTokens + judged.inputTokens,
            outputTokens: candidate.outputTokens + judged.outputTokens,
            candidate: candidateTarget,
            judge: judgeTarget,
            output: candidate.output,
            rubric: judged.rubric,
            errors: passed ? [] : [ judged.rubric.reason ],
            errorCategories: passed ? [] : [ 'rubric_failure' ],
            usage: {
              candidateInputTokens: candidate.inputTokens,
              candidateOutputTokens: candidate.outputTokens,
              judgeInputTokens: judged.inputTokens,
              judgeOutputTokens: judged.outputTokens,
            },
          };
          results.push(row);
          if (!json) {
            console.log(`${passed ? 'PASS' : 'FAIL'} ${testCase.id.padEnd(28)} #${run} ${score}/6 ${row.durationMs}ms`);
            console.log(`  output: ${candidate.output}`);
            console.log(`  rubric: context=${judged.rubric.contextualCoherence}, natural=${judged.rubric.naturalness}, continue=${judged.rubric.encouragesContinuation}`);
            console.log(`  reason: ${judged.rubric.reason}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({
            variant: `${candidateTarget.id}->${judgeTarget.id}`,
            reasoning: 'candidate-default+judge-none',
            caseId: testCase.id,
            caseDescription: testCase.description,
            input: testCase.messages,
            run,
            callSucceeded: false,
            passed: false,
            score: 0,
            durationMs: Math.round(performance.now() - startedAt),
            inputTokens: 0,
            outputTokens: 0,
            candidate: candidateTarget,
            judge: judgeTarget,
            error: message,
            errors: [ message ],
            errorCategories: [ 'call_failure' ],
          });
          if (!json) console.log(`FAIL ${testCase.id.padEnd(28)} #${run} error: ${message}`);
        }
      }
    }
  }

  const payload = {
    title: '主对话 Rubric Eval · DeepSeek Candidate + Qwen Judge',
    experiment: {
      type: rejudgePath ? 'rejudge-fixed-candidates' : 'exploratory',
      ...(rejudgePath ? { source: rejudgePath } : {}),
      timingBoundary: 'candidate generation + judge structured output + schema validation + rubric decision',
      passRule: 'contextualCoherence + naturalness + encouragesContinuation >= 5',
      candidate: candidateTarget,
      judge: judgeTarget,
    },
    cases: cases.map(({ id, description, messages, referenceFacts }) => ({
      id,
      description,
      messages,
      ...(referenceFacts ? { referenceFacts } : {}),
    })),
    candidate: candidateTarget,
    judge: judgeTarget,
    passRule: 'totalScore >= 5',
    runs,
    results,
  };
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`\n逐次结果已写入 ${outputPath}`);
  } else if (json) {
    console.log(JSON.stringify({
      candidate: candidateTarget,
      judge: judgeTarget,
      passRule: 'totalScore >= 5',
      runs,
      results,
    }, null, 2));
  } else {
    const passed = results.filter(item => item.passed).length;
    console.log(`\n主对话 Rubric Eval: ${passed}/${results.length} 通过（阈值 >= 5）。`);
  }
  if (results.some(item => !item.passed)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
