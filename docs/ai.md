# AI 模块 (`app/module/ai/`)

## 定位

AI 模块是整个系统的**核心抽象层**。它不自己实现任何 AI 能力，而是：

1. 定义所有 AI 能力的**类型接口**（`ProductAIService` 抽象类）
2. 定义各类 AI 操作的**输入输出结构**和 **Prompt 模板**
3. 提供两个具体实现（provider）供 DI 容器选择

## 目录结构

```
ai/
├── index.ts                          # 导出 ProductAIService + ChatEvent
├── package.json
├── prompt/                           # Prompt 模板
│   ├── ConversationPrompt.ts         # 对话系统提示词
│   ├── GrammarAnalysisPrompt.ts      # 语法分析提示词
│   ├── MemoryExtractionPrompt.ts     # 记忆提取提示词
│   ├── TranslationPrompt.ts          # 翻译提示词
│   └── VocabularyEnrichmentPrompt.ts # 词汇增强提示词
├── provider/                         # 具体实现
│   ├── TextModelProvider.ts          # 文本模型抽象
│   ├── DeepSeekTextModelProvider.ts  # DeepSeek 实现 (生产)
│   ├── AISDKProductAIService.ts      # 基于 AI SDK 的 ProductAIService 实现 (生产)
│   └── DevelopmentProductAIService.ts # 开发环境 Mock 实现
├── schema/                           # AI 输出的 Zod 校验
│   ├── GrammarAnalysisSchema.ts      # 语法分析结果 Schema
│   ├── MemoryExtractionSchema.ts     # 记忆提取结果 Schema
│   ├── TranslationSchema.ts          # 翻译结果 Schema
│   └── VocabularyEnrichmentSchema.ts # 词汇增强结果 Schema
└── service/
    └── ProductAIService.ts           # 核心抽象类 + 全部类型定义
```

## 核心抽象：ProductAIService

```typescript
abstract class ProductAIService {
  abstract createWelcome(input): Promise<string>;                    // 生成欢迎语
  abstract chat(input): AsyncIterable<ChatEvent>;                    // 流式对话
  abstract analyzeGrammar(input): Promise<GrammarAnalysis>;          // 语法分析
  abstract enrichVocabulary(input): Promise<VocabularyEnrichment>;   // 词汇增强
  abstract translate(input): Promise<TranslationResult>;             // 翻译
  abstract extractMemories(input): Promise<MemoryExtractionResult>;  // 记忆提取
}
```

## 关键数据类型

### ChatEvent (SSE 事件)

```
message.start   → 开始生成回复
message.delta   → 增量文本
correction.ready → 语法纠正
message.done    → 回复完成 (含 token 用量)
error           → 错误
```

### LearnerContext (学习者画像)

```typescript
{
  displayName?: string;
  age?: number;
  occupation?: string;
  englishLevel: CEFRLevel;   // A1~C2
  memories?: string[];        // 长期记忆内容
}
```

### GrammarErrorType (16 种语法错误类型)

`subject_verb_agreement`, `tense`, `article`, `singular_plural`, `countable_uncountable`, `preposition_collocation`, `adjective_adverb`, `comparative`, `pronoun`, `infinitive_gerund`, `modal_verb_form`, `double_negative`, `sentence_fragment`, `chinese_word_order`, `there_be_have`, `duplicate_conjunction`

## 依赖关系

```
             ┌──────────────────────┐
             │   ProductAIService   │  ← 抽象类 (service/)
             │   (6 个抽象方法)      │
             └──────────┬───────────┘
                        │ 被注入到
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
ConversationService  VocabularyService  MemoryExtractionService
TranslationService  (enrichExpression)
(translate)

                        │ 运行时实现
           ┌────────────┴────────────┐
           ▼                         ▼
AISDKProductAIService      DevelopmentProductAIService
(DeepSeek, 生产环境)        (Mock, 开发环境)
```

## 两种 Provider 实现

| 实现 | 环境 | 行为 |
|---|---|---|
| `AISDKProductAIService` | 生产 | 调用 DeepSeek API，真实的流式对话 |
| `DevelopmentProductAIService` | 开发 | 返回固定假数据，不消耗 API 额度 |

## 数据流：一次对话中 AI 模块的角色

```
用户发送 "I go to park yesterday"
│
├─ ai.chat() → 流式生成助手回复
│     ├─ prompt: ConversationPrompt (含 topic, scene, learner 画像)
│     └─ 输出: AsyncIterable<ChatEvent>
│
├─ ai.analyzeGrammar() → 并行分析用户输入的语法
│     ├─ prompt: GrammarAnalysisPrompt
│     └─ 输出: GrammarAnalysis { errors: Correction[] }
│
├─ ConversationService 检测有英文语境的中文表达
│     └─ 后台调用 enrichVocabulary() 并保存，不阻塞聊天流
│
└─ ai.translate() → 按需翻译已保存消息
```

聊天模型不声明、不调用任何词汇 Tool。“How do I say \"散心\" in English”、`for "散心"`、英文句子中夹中文等场景，由 `ConversationService.extractEmbeddedChineseExpressions()` 确定性提取，最多收集 3 个表达。
