# Memory 模块 (`app/module/memory/`)

## 定位

管理用户的**长期记忆**（Learner Profile）。从对话中自动提取用户信息（年龄、职业、偏好、重要事实等），用于个性化 AI 对话。

## 目录结构

```
memory/
├── index.ts                     # 导出 MemoryService, MemoryExtractionService
├── package.json
├── controller/
│   └── MemoryController.ts      # 记忆 API (触发提取/列表/修正/删除)
├── schema/
│   └── MemorySchemas.ts         # Zod 请求校验
└── service/
    ├── MemoryPorts.ts           # 数据存储抽象接口
    ├── MemoryService.ts         # 核心记忆管理逻辑
    └── MemoryExtractionService.ts # AI 记忆提取编排
```

## API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/memories/extractions` | 为当前登录用户触发一次待处理记忆提取 |
| GET | `/api/v1/memories` | 获取用户所有活跃记忆 |
| PATCH | `/api/v1/memories/:id` | 手动修正记忆内容 |
| DELETE | `/api/v1/memories/:id` | 删除记忆 (软删除) |

## 记忆类型、期限与预算

| 类型 | 用途 | 过期时间 |
|---|---|---|
| `profile` | 用户画像 (年龄、职业、英语等级等) | 不自动过期 |
| `preference` | 有个人意义、可跨场景复用的偏好 | 不自动过期 |
| `significant_fact` | 重要事实 (生活事件、目标等) | 不自动过期 |
| `short_term` | 近期可能有用的信息 | AI 选择 7、14 或 30 天 |

活跃且未过期的条数限制：

| 类型 | 最大条数 |
|---|---:|
| `profile` | 10 |
| `preference` | 5 |
| `significant_fact` | 10 |
| `short_term` | 10 |

长期记忆总计最多 25 条。超过分类或总预算时，依次淘汰准入分更低、非明确要求记住、最久未更新的记录。

## 核心流程

### 1. 记忆提取流程

```
App 登录后每 20 分钟触发 POST /api/v1/memories/extractions
│
MemoryExtractionService.processPendingForUser(userId)
│
├─ 1. 加载符合阈值的会话组
│     loadPendingMemoryGroups(minimumMessages=10, maximumMessagesPerGroup=20)
│     → 按 userId + conversationId 独立计数
│     → 少于 10 条保持未扫描；每组只取最早 20 条
│
├─ 2. 加载每组 target 的理解上下文
│     loadExtractionContext(...)
│     → 目标前两条 + 第一条 target 到最后一条 target 的完整消息
│     → 使用 conversation 内递增 sequence 保证 user 始终先于其 assistant 回复
│
├─ 3. 获取已有记忆列表
│     memoryService.list(userId)
│     → 传给 AI 作为去重参考
│
├─ 4. AI 作一次准入决策
│     ai.extractMemories({
│       targetMessageIds: [...], // 唯一允许引用的未扫描 user 消息
│       messages: [...],         // target + 理解上下文
│       existingMemories: [...], // 已有记忆
│     })
│     → { decisions: MemoryAdmissionDecision[1..2] }
│
├─ 5. 服务端校验与复算
│     → 来源必须来自服务端上下文且至少包含一条 target
│     → 拒绝秘密、推测、假设和不明确陈述
│     → 复算分数并执行长期/临时准入门槛
│
├─ 6. 最多应用两条记忆
│     memoryService.applyCandidates(userId, admitted.slice(0, 2))
│
└─ 7. 标记 target messages
      成功（包括 shouldSave=false 或未通过校验）→ memory_scanned_at = now
      调用或保存失败       → 保持 NULL，下次任务重试
```

### 2. 记忆应用 (去重合并)

```
MemoryService.applyCandidates(userId, candidates)
│
├─ 对每个 candidate:
│   ├─ 归一化 normalizedKey (NFKC + 小写 + 去标点)
│   ├─ 按 normalizedKey 匹配已有记忆
│   │
│   ├── 完全匹配 + 同类型 → 保留首次原文，仅更新总结 + 合并 source
│   ├── 匹配但不同类型 → 新建 (不同类型不冲突)
│   ├── 匹配但已过期/删除 → 重新激活
│   └── 无匹配 → 新建记忆
│
└─ 返回所有新增/更新的 MemoryRecord[]
```

AI 不输出 `content`。新建记录的 `content` 始终取最早来源消息的数据库原文；同 key 合并时永远不覆盖已有 `content`，只更新 `summary` 和来源。

准入分由服务端复算：`futureValue + personalImportance + explicitness - penalties.length × 2`。长期记忆通常要求分数至少 4，且 `futureValue >= 1`、`explicitness = 2`；临时记忆至少 2 分。明确要求记住可跳过分数门槛，但秘密信息仍拒绝。

### 3. 记忆 Key 归一化

```
normalizeMemoryKey("I'm a software engineer!")
  → NFKC 归一化 → 去标点 → 小写 → 合并空格
  → "i m a software engineer"
```

同一事实的不同表达方式（标点、大小写变化）会映射到同一个 key，实现去重。

## 记忆生命周期

```
┌─────────┐    AI 提取      ┌────────┐   过期策略   ┌─────────┐
│  创建   │ ──────────────► │ active │ ───────────► │ expired │
│ (新建)  │                 │        │              │ (忽略)  │
└─────────┘                 └───┬────┘              └─────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
               ┌────────┐ ┌────────┐ ┌────────────┐
               │ 修正   │ │ 删除   │ │ 被更优记忆  │
               │ PATCH  │ │ DELETE │ │ 取代        │
               └────────┘ └────────┘ └────────────┘
```

## 数据模型

```
MemoryRecord
┌──────────────────────┐
│ id                   │
│ userId               │
│ type: profile|       │
│   preference|        │
│   significant_fact|  │
│   short_term         │
│ content              │  ← 首次来源的用户原始表述，AI 合并时不可覆盖
│ summary              │  ← 可注入对话的简短习惯/事实总结
│ normalizedKey        │  ← 去重用归一化 key
│ confidence: number   │  ← AI 置信度 0~1
│ admissionScore       │  ← 服务端复算的准入分
│ explicitlyRequested  │  ← 用户是否明确要求记住
│ admissionReason      │  ← AI 决策理由
│ assessmentJson       │  ← 结构化评分与扣分项
│ status: active|      │
│   deleted|superseded │
│ expiresAt?: Date     │
│ deletedAt?: Date     │
│ createdAt/updatedAt  │
└──────────────────────┘
```

## 关键设计

1. **LearnerContext**: 记忆通过 `MemoryService` 加载，把 `summary` 注入每次 AI 调用的 prompt；`content` 保留作来源追溯
2. **AI 提取**: App 登录后每 20 分钟请求一次；服务端只处理 Cookie Session 对应用户的待扫描消息，每个合格会话组只调用一次 AI
3. **Grounding**: 上下文只帮助理解；来源必须属于服务端提供的用户消息并至少命中一条 target
4. **软删除**: 删除是软删除 (`status=deleted`)，可被后续相同 key 的提取重新激活
