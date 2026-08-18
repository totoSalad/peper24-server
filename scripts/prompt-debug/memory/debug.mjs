import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAlibaba } from '@ai-sdk/alibaba';
import { generateText, Output } from 'ai';

import { buildMemoryExtractionPrompt } from '../../../app/module/ai/prompt/MemoryExtractionPrompt.ts';
import { MemoryExtractionSchema } from '../../../app/module/ai/schema/MemoryExtractionSchema.ts';
import { memoryCases } from './cases.mjs';

globalThis.AI_SDK_LOG_WARNINGS = false;

function parseArgs(argv) {
  const valueAfter = flag => {
    const equals = argv.find(value => value.startsWith(`${flag}=`));
    if (equals) return equals.slice(flag.length + 1);
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    caseId: valueAfter('--case'),
    fixturePath: valueAfter('--fixture'),
    allowRealData: argv.includes('--allow-real-data'),
    dryRun: argv.includes('--dry-run'),
    printPrompt: argv.includes('--print-prompt'),
    json: argv.includes('--json'),
  };
}

function evaluate(testCase, decisions) {
  const errors = [];
  const expected = testCase.expectation;
  const saved = decisions.filter(decision => decision.shouldSave);
  if ((saved.length > 0) !== expected.shouldSave) {
    errors.push(`期望 shouldSave=${expected.shouldSave}，实际保存 ${saved.length} 条`);
  }
  if (saved.length > 2) errors.push(`返回超过两条保存决策: ${saved.length}`);
  if (!expected.shouldSave) return errors;
  for (const decision of saved) {
    if (expected.allowedTypes && !expected.allowedTypes.includes(decision.type)) {
      errors.push(`类型 ${decision.type} 不在允许范围 ${expected.allowedTypes.join(', ')}`);
    }
  }
  for (const pattern of expected.summaryMustMatch ?? []) {
    if (!saved.some(decision => pattern.test(decision.summary))) errors.push(`总结未匹配 ${pattern}`);
  }
  const userSources = new Set(testCase.input.messages
    .filter(message => message.role === 'user').map(message => message.id));
  const targets = new Set(testCase.input.targetMessageIds);
  for (const decision of saved) {
    const invalid = decision.sourceMessageIds.filter(id => !userSources.has(id));
    if (invalid.length > 0) errors.push(`引用了非用户消息: ${invalid.join(', ')}`);
    if (!decision.sourceMessageIds.some(id => targets.has(id))) errors.push('决策来源未包含目标消息');
  }
  const slots = saved.map(decision => `${decision.type}:${decision.normalizedKey}`);
  if (new Set(slots).size !== slots.length) errors.push('返回了重复的 type + normalizedKey');
  return errors;
}

function compareMemories(storedMemories, decisions) {
  const slot = memory => `${memory.type}:${memory.normalizedKey}`;
  const storedSlots = new Set(storedMemories.map(slot));
  const decisionSlots = new Set(decisions.filter(decision => decision.shouldSave).map(slot));
  return {
    matched: [ ...storedSlots ].filter(value => decisionSlots.has(value)),
    storedOnly: [ ...storedSlots ].filter(value => !decisionSlots.has(value)),
    decisionOnly: [ ...decisionSlots ].filter(value => !storedSlots.has(value)),
  };
}

async function loadFixtureCase(fixturePath) {
  const fixture = JSON.parse(await readFile(resolve(fixturePath), 'utf8'));
  return {
    id: `real-${fixture.conversation.id}`,
    description: `真实会话 ${fixture.conversation.id} 的消息与数据库记忆对比`,
    input: {
      targetMessageIds: fixture.targetMessageIds,
      messages: fixture.messages.map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
      })),
      existingMemories: fixture.existingMemories,
    },
    expectation: { shouldSave: false },
    storedMemories: fixture.storedMemories,
  };
}

async function extract(model, input) {
  const result = await generateText({
    model,
    output: Output.object({
      name: 'MemoryAdmission',
      description: 'Up to two conservative final memory decisions grounded in source messages.',
      schema: MemoryExtractionSchema,
    }),
    prompt: buildMemoryExtractionPrompt(input),
  });
  return result.output;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.fixturePath && options.caseId) {
    throw new Error('--fixture 和 --case 不能同时使用');
  }
  const selected = options.fixturePath
    ? [ await loadFixtureCase(options.fixturePath) ]
    : options.caseId
      ? memoryCases.filter(testCase => testCase.id === options.caseId)
      : memoryCases;
  if (selected.length === 0) {
    throw new Error(`未知场景 ${options.caseId}。可用场景: ${memoryCases.map(item => item.id).join(', ')}`);
  }

  if (options.printPrompt) {
    for (const testCase of selected) {
      console.log(`\n===== ${testCase.id} =====\n`);
      console.log(buildMemoryExtractionPrompt(testCase.input));
    }
  }
  if (options.dryRun) {
    console.log(`\n已检查 ${selected.length} 个场景；dry-run 未调用模型。`);
    return;
  }

  if (options.fixturePath && !options.allowRealData) {
    throw new Error('真实 fixture 会发送完整消息给外部模型；确认授权后请显式添加 --allow-real-data');
  }

  if (!process.env.DASHSCOPE_API_KEY) {
    throw new Error('缺少 DASHSCOPE_API_KEY；可写入仓库根目录 .env，或使用 --dry-run');
  }
  const modelId = process.env.BAILIAN_MODEL ?? 'qwen3.7-flash';
  const bailian = createAlibaba({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: process.env.BAILIAN_BASE_URL
      ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });
  const model = bailian(modelId);
  const report = [];

  for (const testCase of selected) {
    const startedAt = Date.now();
    try {
      const result = await extract(model, testCase.input);
      const errors = evaluate(testCase, result.decisions);
      report.push({
        id: testCase.id,
        description: testCase.description,
        passed: errors.length === 0,
        durationMs: Date.now() - startedAt,
        storedMemories: testCase.storedMemories ?? [],
        decisions: result.decisions,
        comparison: compareMemories(testCase.storedMemories ?? [], result.decisions),
        errors,
      });
    } catch (error) {
      report.push({
        id: testCase.id,
        description: testCase.description,
        passed: false,
        durationMs: Date.now() - startedAt,
        storedMemories: testCase.storedMemories ?? [],
        decisions: [{ shouldSave: false, reason: '调用失败' }],
        comparison: compareMemories(testCase.storedMemories ?? [], []),
        errors: [ error instanceof Error ? error.message : String(error) ],
      });
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ model: modelId, report }, null, 2));
  } else {
    console.log(`\n记忆 Prompt 调试 · ${modelId}`);
    for (const item of report) {
      console.log(`\n${item.passed ? 'PASS' : 'FAIL'} ${item.id} (${item.durationMs}ms)`);
      console.log(`  ${item.description}`);
      for (const memory of item.storedMemories) {
        console.log(`  = DB [${memory.type}] ${memory.summary ?? memory.content} <${memory.normalizedKey}>`);
      }
      for (const decision of item.decisions) {
        if (decision.shouldSave) {
          console.log(`  + AI [${decision.type}] ${decision.summary} <${decision.normalizedKey}>`);
          console.log(`      来源: ${decision.sourceMessageIds.join(', ')}`);
        } else {
          console.log(`  - AI 不保存: ${decision.reason}`);
        }
      }
      if (item.storedMemories.length > 0) {
        console.log(`  对比: 相同 ${item.comparison.matched.length}，仅 DB ${item.comparison.storedOnly.length}，仅 AI ${item.comparison.decisionOnly.length}`);
        for (const value of item.comparison.storedOnly) console.log(`  < 仅 DB: ${value}`);
        for (const value of item.comparison.decisionOnly) console.log(`  > 仅 AI: ${value}`);
      }
      for (const error of item.errors) console.log(`  ! ${error}`);
    }
    console.log(`\n${report.filter(item => item.passed).length}/${report.length} 场景通过`);
  }

  if (report.some(item => !item.passed)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
