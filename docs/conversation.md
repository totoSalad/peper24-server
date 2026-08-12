# Conversation 模块 (`app/module/conversation/`)

## 定位

管理用户与 AI 之间的**对话会话**。支持创建话题会话、流式消息交互（SSE）、幂等去重，以及消息翻译。

## 目录结构

```
conversation/
├── index.ts                            # 导出 ConversationService, TranslationService
├── package.json                        # Egg 模块声明
├── controller/
│   ├── ConversationController.ts       # 对话 API
│   └── TranslationController.ts        # 翻译 API
├── schema/
│   └── ConversationSchemas.ts          # Zod 请求校验
└── service/
    ├── ConversationPorts.ts            # 数据存储抽象接口
    ├── ConversationService.ts          # 核心业务逻辑
    └── TranslationService.ts           # 消息翻译服务
```

## API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/conversations` | 创建新会话（含 AI 欢迎语） |
| GET | `/api/v1/conversations` | 获取会话列表 |
| GET | `/api/v1/conversations/:id/messages` | 获取某会话的消息列表 |
| POST | `/api/v1/conversations/:id/messages/stream` | **SSE 流式发送消息** |
| POST | `/api/v1/messages/:id/translation` | 翻译消息 |

## 数据模型

```
ConversationRecord                    MessageRecord
┌──────────────────────┐            ┌──────────────────────────┐
│ id                   │◄───────────│ conversationId           │
│ userId               │            │ id                       │
│ topic                │            │ replyToMessageId (可选)  │
│ scene (可选)          │            │ role: user | assistant   │
│ status: active|archived│          │ status: streaming|       │
│ nextMessageSequence    │          │ sequence                 │
│ createdAt/updatedAt  │            │   completed|interrupted  │
└──────────────────────┘            │ content                  │
                                    │ translation (可选)       │
                                    │ correctionJson (可选)    │
                                    │ toolEventsJson (可选)    │
                                    │ clientRequestId (可选)   │
                                    │ createdAt/updatedAt      │
                                    └──────────────────────────┘
```

## 核心流程：流式消息 (`streamMessage`)

```
POST /api/v1/conversations/:id/messages/stream
│
├─ 1. 鉴权 ──► AccountService.getCurrentUser()
├─ 2. 校验 ──► Zod: content(1~4000), clientRequestId(1~128)
├─ 3. 会话校验 ──► 会话存在 & 属于当前用户
├─ 4. beginExchange() ──── 幂等性屏障 ──────┐
│     │                                       │
│     ├── 锁定 conversation，连续分配 user/assistant sequence
│     ├── 新请求 (created: true) → 继续       │
│     └── 重复请求 (created: false)           │
│           ├── 已完成 → replay() 返回缓存     │
│           └── 中断过 → resume 重新生成       │
│                                              │
├─ 5. 并行启动 ───────────────────────────────┘
│     ├── ai.chat()          (主流程,流式)
│     └── ai.analyzeGrammar() (并行,catch兜底)
│
├─ 6. AI 流式主循环
│     for await (event of ai.chat())
│     │
│     ├── message.start   → SSE: event=message.start
│     ├── message.delta   → 累积内容 + 透传 SSE
│     ├── tool.call       → 记录到 toolEvents
│     │     ├── explainExpression → VocabularyService
│     │     └── addVocabulary    → VocabularyService
│     ├── tool.result     → 记录 + 透传 SSE
│     ├── message.done    → 记录 usage → 退出循环
│     └── error           → 抛异常
│
├─ 8. 完成阶段 (completeAssistant)
│     持久化内容 + grammar 分组 + toolEvents
│     → 返回 corrections[]
│
├─ 9. SSE 收尾事件
│     ├── correction.ready × N
│     └── message.done (含 token 用量)
│
└─ 异常处理
      interruptAssistant() → 保存部分内容
      SSE: { type: 'error', retryable: true }
```

## SSE 事件类型汇总

| event | 说明 |
|---|---|
| `message.start` | AI 开始生成 |
| `message.delta` | 增量文本 |
| `tool.call` | AI 调用工具 (查词/加生词) |
| `tool.result` | 工具执行结果 |
| `correction.ready` | 语法纠正建议 |
| `message.done` | 回复完成 (含 token 用量) |
| `error` | 错误 (含 code + retryable) |

## TranslationService 翻译流程

```
POST /api/v1/messages/:id/translation
│
├─ 1. 查消息归属 → 消息存在 & 属于当前用户
├─ 2. 已有翻译? → 直接返回 (数据库缓存)
├─ 3. inFlight Map 去重 → 防并发重复翻译
│     同一消息并发请求共享同一个 Promise
├─ 4. ai.translate()
│     ├─ 自动检测: 含中文 → 英译, 否则 → 中译
│     └─ 生成翻译结果
└─ 5. 持久化翻译 → 返回
```

## 关键设计

1. **幂等性**: `beginExchange()` 通过 `clientRequestId` 查重，网络重试不会产生重复消息
2. **中断恢复**: 被中断的 assistant 消息 (status=interrupted) 可以重新生成
3. **稳定顺序**: conversation 在事务内分配递增 `sequence`；读取、Prompt 上下文均不依赖相同时间戳或 ULID 随机部分排序
3. **SSE 流式**: `AsyncIterable<ChatEvent>` + PassThrough stream，前端实时看到逐字输出
4. **连接感知**: 监听 `req.aborted` 和 `res.close`，通过 `AbortSignal` 取消底层 AI 请求
5. **优雅降级**: 语法分析失败使用空结果兜底，不阻塞主对话流
