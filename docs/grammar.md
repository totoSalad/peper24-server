# Grammar 模块 (`app/module/grammar/`)

## 定位

处理 AI 返回的**语法分析结果**，进行归类、去重、持久化，并在用户累计犯同一个错误 2 次时触发**纠正提醒**。

## 目录结构

```
grammar/
├── index.ts                  # 导出 GrammarService + GrammarOccurrenceGroup
├── package.json
└── service/
    ├── GrammarPorts.ts       # 类型定义 (GrammarOccurrenceGroup)
    └── GrammarService.ts     # 语法分析结果的分类与归一化
```

## 核心类型

```typescript
// 16 种语法错误类型
type GrammarErrorType =
  'subject_verb_agreement' | 'tense' | 'article' |
  'singular_plural' | 'countable_uncountable' | 'preposition_collocation' |
  'adjective_adverb' | 'comparative' | 'pronoun' |
  'infinitive_gerund' | 'modal_verb_form' | 'double_negative' |
  'sentence_fragment' | 'chinese_word_order' | 'there_be_have' |
  'duplicate_conjunction';

// AI 返回的单个纠正
interface Correction {
  errorType: GrammarErrorType;
  original: string;    // 用户原文
  corrected: string;   // 纠正后的正确写法
  note: string;        // 纠正说明
}

// 按类型分组后的结构
interface GrammarOccurrenceGroup {
  errorType: GrammarErrorType;
  details: Correction[];
}
```

## 核心流程

```
ai.analyzeGrammar(content)
│
│  返回 GrammarAnalysis {
│    explicitGrammarQuestion: boolean
│    errors: Correction[]
│  }
│
▼
GrammarService.prepare(analysis)
│
├─ 1. 如果是显性语法提问 → 跳过 (return [])
│      (用户问的就是语法规则,不需要纠正)
│
├─ 2. 去重归一化
│     normalize(correction):
│     ├─ trim() original / corrected / note
│     ├─ original === corrected → 丢弃
│     ├─ 任一为空 → 丢弃
│     └─ 截断: original≤300, corrected≤300, note≤200
│
├─ 3. 最多取前 8 个错误
│     errors.slice(0, 8)
│
├─ 4. 按 errorType 分组
│     Map<GrammarErrorType, Correction[]>
│
└─ 5. 排序返回
      按 errorType 字母序排列
      → GrammarOccurrenceGroup[]
```

## 纠正触发机制 (在 MysqlConversationRepository 中)

`completeAssistant()` 调用 `recordGrammarGroups()` 时：

```
每个 GrammarOccurrenceGroup:
│
├─ 1. UPSERT grammar_error_patterns 表
│     (errorType + userId 唯一)
│
├─ 2. 查 pattern.occurrence_count + corrected_at
│
├─ 3. 插入 grammar_error_occurrences 表
│     (记录本次犯错详情 JSON)
│
├─ 4. occurrence_count += 1
│
└─ 5. SHOULD CORRECT?
       条件: occurrence_count === 2 && !corrected_at
       │
       ├─ YES → 设置 corrected_at = now
       │        返回 corrections (推送给用户)
       │
       └─ NO  → 不纠正,等下次
```

**简单规则**: 同一个语法错误类型累计出现 2 次且从未被纠正过 → 触发纠正。

## 数据库表

| 表 | 用途 |
|---|---|
| `grammar_error_patterns` | 错误类型统计 (errorType, userId, occurrence_count, corrected_at) |
| `grammar_error_occurrences` | 每次犯错的详情 (pattern_id, user_message_id, details_json) |

## 与其他模块的关系

```
ConversationService
  │
  ├─ ai.analyzeGrammar()  ← 并行启动, 不阻塞对话
  │     └─ AI 分析用户输入的语法错误
  │
  ├─ grammar.prepare()     ← 对 AI 结果归类/去重
  │
  └─ conversations.completeAssistant()
        └─ recordGrammarGroups()
              └─ 持久化 + 触发纠正逻辑
```
