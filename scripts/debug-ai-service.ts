/**
 * Standalone debug script for AISDKProductAIService.
 *
 * 不依赖 Egg.js 容器，直接实例化和调试 AI 服务的每个方法。
 *
 * 用法:
 *   # 默认: Development fallback（不需要 API key）
 *   npx tsx scripts/debug-ai-service.ts
 *
 *   # 只测某个方法
 *   npx tsx scripts/debug-ai-service.ts --method chat
 *
 *   # 真实 DeepSeek API
 *   DEEPSEEK_API_KEY=sk-xxx npx tsx scripts/debug-ai-service.ts --real
 *
 *   # Debug 模式（打印完整错误堆栈）
 *   DEBUG=1 npx tsx scripts/debug-ai-service.ts
 */

// 尝试加载 .env 文件（可选依赖）
try { require('dotenv/config'); } catch { /* dotenv 未安装 */ }

import { createDeepSeek } from '@ai-sdk/deepseek';
import { Logger } from '@eggjs/tegg';
import type { LanguageModel } from 'ai';

import { AISDKProductAIService } from '../app/module/ai/provider/AISDKProductAIService';
import {
  ResolvedTextModel,
  TextModelProvider,
} from '../app/module/ai/provider/TextModelProvider';
import type { ChatEvent } from '../app/module/ai/service/ProductAIService';

// ---------------------------------------------------------------------------
// TextModelProvider 实现
// ---------------------------------------------------------------------------

class StaticTextModelProvider extends TextModelProvider {
  constructor(private readonly resolved: ResolvedTextModel | null) {
    super();
  }
  resolve(): ResolvedTextModel | null {
    return this.resolved;
  }
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

// 独立脚本没有 Egg DI，注入一个输出到 console 的 logger，
// 这样工具使用日志能直接在调试终端里看到。
const debugLogger: Logger = {
  debug: () => {},
  log: () => {},
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

/** Development fallback — resolve() 返回 null，所有方法走 DevelopmentProductAIService */
function createDevService() {
  return new AISDKProductAIService(new StaticTextModelProvider(null), debugLogger);
}

/** DeepSeek 真实 API */
function createDeepSeekService(): AISDKProductAIService {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error('❌ 缺少 DEEPSEEK_API_KEY 环境变量');
    console.error('   export DEEPSEEK_API_KEY=sk-xxx');
    console.error('   或创建 .env 文件: DEEPSEEK_API_KEY=sk-xxx');
    process.exit(1);
  }
  const modelId = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
  const deepseek = createDeepSeek({
    apiKey,
    ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}),
  });
  return new AISDKProductAIService(
    new StaticTextModelProvider({
      model: deepseek(modelId) as unknown as LanguageModel,
      provider: 'deepseek',
      modelId,
    }),
    debugLogger,
  );
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function banner(title: string) {
  const line = '═'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}\n`);
}

function divider() {
  console.log('─'.repeat(60));
}

function printEvent(event: ChatEvent, index: number) {
  const prefix = `  [${index}]`;
  if (event.type === 'message.delta') {
    process.stdout.write(event.delta);
  } else if (event.type === 'message.done') {
    console.log(`\n${prefix} message.done  usage=${JSON.stringify(event.usage)}`);
  } else {
    const { type, ...rest } = event;
    const details = Object.keys(rest).length ? `  ${JSON.stringify(rest).slice(0, 120)}` : '';
    console.log(`${prefix} ${type}${details}`);
  }
}

// ---------------------------------------------------------------------------
// 各方法调试用例
// ---------------------------------------------------------------------------

async function debugCreateWelcome(service: AISDKProductAIService) {
  banner('createWelcome');
  const inputs = [
    { topic: 'weekend activities', scene: 'coffee shop' },
    { topic: 'travel', scene: '餐厅点餐' }, // 触发 dev 模式下的特殊分支
  ];
  for (const input of inputs) {
    const welcome = await service.createWelcome({
      userId: 'debug-user',
      ...input,
      learner: { englishLevel: 'B1', displayName: 'Debug' },
    });
    console.log(`  topic="${input.topic}" scene="${input.scene ?? ''}"`);
    console.log(`  → "${welcome}"`);
    divider();
  }
}

async function debugChat(service: AISDKProductAIService) {
  banner('chat (streaming)');
  const stream = service.chat({
    messageId: 'debug-msg-1',
    userId: 'debug-user',
    conversationId: 'debug-conv-1',
    topic: 'Coffee',
    history: [],
    content: 'I like drinking coffee in the morning.',
    learner: { englishLevel: 'B1' },
  });

  let index = 0;
  for await (const event of stream) {
    printEvent(event, index++);
  }
  if (index === 0) console.log('  (no events)');
}

async function debugAnalyzeGrammar(service: AISDKProductAIService) {
  banner('analyzeGrammar');
  const cases = [
    'She like playing basketball.',
    'Yesterday I go to the park.',
    'Is "he go" correct grammar?',
    'I bought book yesterday.',
    'It depend of the weather.',
  ];
  for (const content of cases) {
    const result = await service.analyzeGrammar({
      content,
      learner: { englishLevel: 'B1' },
    });
    const summary = result.errors.length
      ? result.errors.map(e => `${e.errorType}: "${e.original}"→"${e.corrected}"`).join('; ')
      : '(none)';
    console.log(`  "${content}"`);
    console.log(`    → question=${result.explicitGrammarQuestion}, errors=[${summary}]`);
  }
}

async function debugEnrichVocabulary(service: AISDKProductAIService) {
  banner('enrichVocabulary');
  const cases = [
    { text: 'whole wheat bread', context: 'Would you like your sandwich on whole wheat bread?' },
    { text: 'rain check', context: 'Can I take a rain check on that?' },
    { text: 'procrastinate', context: 'I tend to procrastinate when it comes to homework.' },
  ];
  for (const { text, context } of cases) {
    const r = await service.enrichVocabulary({ text, context });
    if (!r) {
      console.log(`  "${text}" → skipped (person name)`);
      divider();
      continue;
    }
    console.log(`  "${text}" → ${r.cnMeaning} / ${r.enMeaning}`);
    console.log(`    phonetic: ${r.phonetic}`);
    console.log(`    example:  "${r.example}"`);
    divider();
  }
}

async function debugTranslate(service: AISDKProductAIService) {
  banner('translate');
  const cases = [
    { content: 'I would like a cup of coffee, please.', targetLanguage: 'Chinese' as const },
    { content: '今天天气真好，我们去公园散步吧。', targetLanguage: 'English' as const },
  ];
  for (const input of cases) {
    const r = await service.translate(input);
    console.log(`  "${input.content.slice(0, 50)}..."`);
    console.log(`  → "${r.translation}"`);
    divider();
  }
}

async function debugExtractMemories(service: AISDKProductAIService) {
  banner('extractMemories');
  const r = await service.extractMemories({
    targetMessageIds: [ 'u1' ],
    messages: [
      { id: 'm1', role: 'user', content: 'I really like hiking on weekends.' },
      { id: 'm2', role: 'assistant', content: 'That sounds fun! Where do you usually go?' },
      { id: 'm3', role: 'user', content: 'I live in Beijing, so usually the mountains nearby.' },
      { id: 'm4', role: 'assistant', content: 'Beijing has great hiking spots!' },
      { id: 'm5', role: 'user', content: 'Yes, and I prefer morning hikes because it\'s cooler.' },
    ],
    existingMemories: [],
  });
  for (const decision of r.decisions) {
    console.log(`  shouldSave=${decision.shouldSave} reason="${decision.reason}"`);
    if (decision.shouldSave) {
      console.log(`    [${decision.type}] ${decision.summary}`);
      console.log(`      key="${decision.normalizedKey}" sources=[${decision.sourceMessageIds.join(',')}]`);
    }
  }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  // 解析 --method=xxx 或 --method xxx
  let methodFilter: string | undefined;
  const methodEq = args.find(a => a.startsWith('--method='));
  if (methodEq) {
    methodFilter = methodEq.split('=')[1];
  } else {
    const idx = args.indexOf('--method');
    if (idx >= 0 && idx + 1 < args.length) methodFilter = args[idx + 1];
  }

  // 确定模式和服务
  let service: AISDKProductAIService;
  let modeLabel: string;

  if (args.includes('--real')) {
    service = createDeepSeekService();
    modeLabel = `DeepSeek API (model=${process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'})`;
  } else {
    service = createDevService();
    modeLabel = 'Development fallback (resolve()=null → DevelopmentProductAIService)';
  }

  console.log('\n🔧 AISDKProductAIService 独立调试');
  console.log(`   模式: ${modeLabel}`);

  // 方法注册表
  const methods: Array<{ name: string; fn: (s: AISDKProductAIService) => Promise<void> }> = [
    { name: 'createWelcome', fn: debugCreateWelcome },
    { name: 'chat', fn: debugChat },
    { name: 'analyzeGrammar', fn: debugAnalyzeGrammar },
    { name: 'enrichVocabulary', fn: debugEnrichVocabulary },
    { name: 'translate', fn: debugTranslate },
    { name: 'extractMemories', fn: debugExtractMemories },
  ];

  const names = methods.map(m => m.name).join(', ');
  console.log(`   方法: ${methodFilter ?? 'all'}  (可用: ${names})\n`);

  const filtered = methodFilter
    ? methods.filter(m => m.name === methodFilter)
    : methods;

  if (methodFilter && filtered.length === 0) {
    console.error(`❌ 未知方法: "${methodFilter}"`);
    console.error(`   可用: ${names}`);
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;

  for (const { name, fn } of filtered) {
    try {
      await fn(service);
      ok++;
    } catch (error) {
      fail++;
      console.error(`\n❌ ${name} 失败:`);
      if (error instanceof Error) {
        console.error(`   ${error.constructor.name}: ${error.message}`);
        if (process.env.DEBUG) console.error(error.stack);
      } else {
        console.error(`   ${error}`);
      }
    }
  }

  banner(`调试完成  (${ok} passed, ${fail} failed)`);
  if (fail > 0) process.exit(1);
}

main().catch(error => {
  console.error('调试脚本异常:', error);
  process.exit(1);
});
