# Vocabulary 模块 (`app/module/vocabulary/`)

## 定位

管理用户的**生词本**。支持手动添加生词、AI 自动增强词汇信息（音标、释义、例句）、以及基于 **SM-2 间隔复习算法**的复习系统。

## 目录结构

```
vocabulary/
├── index.ts                     # 导出 VocabularyService + ReviewResult
├── package.json
├── controller/
│   └── VocabularyController.ts  # 词汇管理 + 复习 API
│       ├── VocabularyController /api/v1/vocabularies
│       └── ReviewController     /api/v1/reviews
├── schema/
│   └── VocabularySchemas.ts     # Zod 请求校验
└── service/
    ├── VocabularyPorts.ts       # 数据存储抽象接口
    ├── VocabularyService.ts     # 核心业务逻辑
    └── ReviewScheduler.ts       # SM-2 间隔复习调度算法
```

## API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/vocabularies` | 获取生词本列表 |
| POST | `/api/v1/vocabularies` | 手动添加生词 (AI 增强) |
| DELETE | `/api/v1/vocabularies/:id` | 删除生词 |
| GET | `/api/v1/reviews/today` | 获取今日待复习词汇 (最多 10 个) |
| POST | `/api/v1/reviews/:id/answer` | 提交复习结果 (again/hard/good/easy) |

## 数据模型

```
VocabularyRecord            ReviewStateRecord
┌──────────────────────┐   ┌──────────────────────┐
│ id                   │   │ vocabularyId         │
│ userId               │   │ repetitions: number  │
│ expression           │   │ intervalDays: number │
│ normalizedExpression │   │ easinessFactor: num  │
│ originalExpression   │   │ nextReviewAt: Date   │
│ phonetic             │   │ updatedAt: Date      │
│ partOfSpeech         │   └──────────────────────┘
│ meaning              │
│ example              │   VocabularyContextRecord
│ lastEncounteredAt    │   ┌──────────────────────┐
│ createdAt/updatedAt  │   │ id                   │
└──────────────────────┘   │ vocabularyId         │
                           │ messageId            │
                           │ sentence             │
                           │ createdAt            │
                           └──────────────────────┘
```

## 核心流程

### 流程 1：添加生词 (`addFromSelection`)

```
POST /api/v1/vocabularies
│
├─ 1. 校验: expression(1~200 字符)
│
├─ 2. 查找来源消息
│     findSourceMessage(userId, sourceMessageId)
│     → 消息存在 + 属于当前用户
│
├─ 3. 二次校验
│     normalizeExpression(source.content)
│       .includes(normalizeExpression(selected))
│     → 确保选中的词确实在来源消息中
│
├─ 4. AI 词汇增强 (重试 2 次)
│     ai.enrichVocabulary({ text, context, learner })
│     → {
│         expression,          // 生词
│         normalizedExpression, // 归一化形式
│         phonetic,            // 音标
│         partOfSpeech,        // 词性
│         meaning,             // 中文释义
│         example,             // 例句
│       }
│
└─ 5. 保存
      saveEnriched()
      ├─ 创建 VocabularyRecord
      ├─ 创建 VocabularyContextRecord (来源消息ID)
      └─ 创建 ReviewStateRecord (初始复习状态)
           repetitions=0, intervalDays=0
           easinessFactor=2.5, nextReviewAt=now (立即可复习)
```

### 流程 2：对话自动收集 (`addFromConversation`)

当用户消息在英文语境中包含中文词或短语时，`ConversationService` 会后台启动自动收集。包括 `How do I say "散心" in English`、`for "散心"`、`"散心" means ...` 和普通英文句子夹中文：

```
extractEmbeddedChineseExpressions() → enrichExpression() → addFromConversation()
│
├─ saveEnriched()
│     直接使用已获取的词汇信息
│     关联到当前消息
│     → 用户无需手动操作，对话中自动加入生词本
│
└─ 该后台任务不被 chat 或 message.done await，失败仅记录 warning
```

### 流程 3：间隔复习 (SM-2 算法)

```
GET /api/v1/reviews/today?limit=10
│
└─ 查询 nextReviewAt <= now 的词汇, 按 nextReviewAt ASC, 最多 10 个

POST /api/v1/reviews/:id/answer { result: 'again'|'hard'|'good'|'easy', clientRequestId }
│
├─ 分数映射: again=0, hard=2, good=3, easy=5
│
└─ scheduleReview(currentState, score, reviewedAt)
```

### SM-2 算法实现 (`ReviewScheduler`)

```
scheduleReview(current, score, reviewedAt)

输入:
  current.repetitions     (已复习次数)
  current.intervalDays    (当前间隔天数)
  current.easinessFactor  (容易度因子, 初始 2.5, 最低 1.3)

│
├─ 1. 如果 score < 3 (again=0, hard=2)
│     → 重置: repetitions=0, intervalDays=1
│
├─ 2. 如果 score >= 3 (good=3, easy=5)
│     → repetitions += 1
│     → 新 interval:
│         repetitions=1 → 1天
│         repetitions=2 → 6天
│         ≥3           → intervalDays × easinessFactor (最少 1 天)
│
├─ 3. 更新 easinessFactor:
│     EF' = EF + (0.1 - (5-score) × (0.08 + (5-score) × 0.02))
│     四舍五入到小数点后 4 位, 最小值 1.3
│
│     示例:
│       good(3): +0.1 - 2 × (0.08 + 2×0.02) = -0.14
│       easy(5): +0.1 - 0 × 0.08 = +0.1
│       hard(2): +0.1 - 3 × (0.08 + 3×0.02) = -0.32
│       again(0): 直接重置, 不更新 EF
│
└─ 返回新的 ReviewStateRecord
     nextReviewAt = reviewedAt + intervalDays × 86400000ms
```

### 复习进度示意

```
Day 0     Day 1     Day 6        Day 15           Day 37
  │         │         │            │                │
  ├─ 初学 ──┤         │            │                │
            ├─ good ──┤            │                │
                      ├─ good ─────┤                │
                                   ├─ good ──────────┤
                                                     ├─ easy (EF ↑)
```

## 两种添加方式

| 方式 | 触发者 | 场景 |
|---|---|---|
| `addFromSelection` | 用户手动 | 用户选中消息中的词 → POST /api/v1/vocabularies |
| `addFromConversation` | 服务端检测 | 检测英文语境中的中文表达，后台增强并保存，不经过模型 Tool |

## 关键设计

1. **去重归一化**: `normalizeExpression()` — NFKC + 去标点 + 小写，确保 "Hello," 和 "hello" 映射到同一个 key
2. **Source Message 校验**: 添加生词时必须验证该词确实在来源消息中出现过，防止前端传参错误
3. **AI 增强重试**: `enrichVocabulary` 失败自动重试一次，减少因 AI 抖动导致的操作失败
4. **幂等复习**: `answer` 带 `clientRequestId`，防止网络重试产生重复分数
5. **SM-2 算法**: 经典的间隔复习调度，根据用户自评动态调整复习间隔
