# Peper24 Server 技术方案

> 状态：一期实现基线  
> 产品依据：Peper24 配套产品设计与技术设计文档  
> 原则：优先完成可上线的模块化单体，不为未验证的规模提前引入微服务、消息中间件、向量数据库或 Kubernetes。

当前落地进度：System、Infrastructure、Account、Conversation、文本 AI、Grammar、Vocabulary / Review、Translation 和 Memory 业务垂直切片已经实现。Conversation 已具备 MySQL 消息持久化、POST SSE、自有事件协议、客户端请求幂等和中断恢复；Translation 已支持权限过滤、结构化输出、数据库缓存和并发合并；Memory 已包含结构化提取、来源校验、合并/替换、过期过滤、删除墓碑、变更日志、Prompt 注入和用户管理 API，待 Worker 切片接入静默会话调度。

## 1. 一期目标与边界

Peper24 Server 为英语口语陪练 Web 应用提供账户、会话、AI 对话、生词复习和用户记忆能力。消息朗读由浏览器本地语音能力提供，不经过服务端。

已确认的产品规则：

- AI 陪练只有一个固定角色；
- 同一种语法错误第 1 次出现时静默，第 2 次自然纠正一次，之后保持静默；
- 英语水平由用户按 CEFR A1～C2 自评；
- 复习评分由服务端根据答题行为自动计算；
- 产品只有一个版本，不做免费版、Pro、Max 权益分层。

一期不做：原生 App、多人聊天、微服务、独立 AI 网关、自动多模型路由、向量数据库、逐词音频强制对齐。

## 2. 技术选型

- Runtime：Node.js 20+
- Web：Egg.js 4 + TEGG + TypeScript
- 参数与 AI 结构校验：Zod
- 数据库：MySQL 8 + Leoric，所有结构变化通过 Migration 管理
- 临时状态：Redis 7，用于 Session、限流和短期锁
- 文本 AI：Vercel AI SDK `ai` + `@ai-sdk/deepseek` + `@ai-sdk/alibaba`
- 部署：Docker Compose；同一个镜像通过运行角色区分 API 与 Worker

鉴权采用 Redis Session + HttpOnly Cookie，不使用存放在浏览器 `localStorage` 的 JWT。

## 3. 总体结构

```text
peper24-app
    │
    │ HTTPS + JSON / POST SSE
    ▼
Nginx
    ▼
Egg.js + TEGG
    ├── middleware：认证、错误处理、Request ID
    ├── account：账户、Session、个人资料
    ├── conversation：会话、消息、流式回复、语法纠正
    ├── vocabulary：生词、上下文、SM-2 复习
    ├── memory：记忆提取、冲突、过期和用户管理
    └── ai：ProductAIService、Prompt、模型 Provider

基础资源：MySQL + Redis
外部服务：DeepSeek 或阿里云百炼
```

服务端保持模块化单体。模块之间通过公开 Service 或明确的接口协作，不通过 HTTP/RPC 在同一进程内互相调用。

## 4. 项目目录

```text
app/
├── middleware/
│   ├── auth.ts
│   ├── errorHandler.ts
│   └── requestContext.ts
├── model/
│   ├── User.ts
│   ├── UserProfile.ts
│   ├── Conversation.ts
│   ├── Message.ts
│   ├── Vocabulary.ts
│   └── ...
└── module/
    ├── account/
    │   ├── controller/
    │   ├── service/
    │   └── schema/
    ├── conversation/
    ├── vocabulary/
    ├── memory/
    ├── ai/
    │   ├── service/
    │   ├── provider/
    │   ├── prompt/
    │   └── schema/
    └── infrastructure/
        ├── database/
        └── redis/

database/
└── migrations/

test/
├── unit/
├── integration/
└── support/
```

目录职责：

- `middleware`：处理跨模块 HTTP 关注点，不实现业务规则；
- `model`：Leoric 数据库映射，允许声明关联和持久化字段，不处理 HTTP 或第三方 SDK；
- `controller`：协议转换、身份上下文、状态码和响应，不直接访问数据库；
- `service`：业务规则与用例编排，是单元测试的主要对象；
- `schema`：Zod 请求、响应和结构化 AI 输出 Schema，只做结构与格式校验；
- `infrastructure`：MySQL、Redis 的连接、Repository 和技术实现；
- `ai/provider`：AI SDK 和厂商类型的隔离层；
- `ai/prompt`：版本化 Prompt 模板；
- `database/migrations`：唯一允许变更生产数据库结构的入口。

依赖方向：

```text
middleware -> controller -> service -> model / infrastructure interface
conversation / vocabulary / memory -> ProductAIService interface
ProductAIService -> provider -> Vercel AI SDK / vendor API
```

Service 不写死 Redis、邮件或 AI 实现。外部能力使用可注入的抽象类作为运行时 DI Token，测试时替换为 Fake。

## 5. TDD 开发规则

每个功能切片按以下顺序开发：

1. 写一个描述可观察业务行为的失败测试；
2. 写最少实现使测试通过；
3. 补充边界、权限、并发和幂等测试；
4. 在测试保护下重构；
5. 为真实 MySQL、Redis 或 HTTP Adapter 补集成测试；
6. 运行 lint、TypeScript build、unit、integration。

测试分层：

### 5.1 Unit

- 不启动 Egg；
- 不连接 MySQL、Redis；
- 不请求 DeepSeek、阿里云百炼或邮件；
- 使用 `InMemoryRepository`、`FakeClock`、`FixedIdGenerator`、`FakeProductAIService`；
- 重点覆盖 Service 和纯业务规则。

### 5.2 Integration

- Controller 测试使用 `@eggjs/mock`；
- Persistence 测试连接独立的 `peper24_test` 数据库；
- Redis 测试使用独立 DB 编号或 Key 前缀；
- 验证 Migration、唯一索引、事务、Session TTL、HTTP Cookie、SSE 事件格式。

### 5.3 External contract

真实厂商契约测试不进入默认测试命令。只有显式提供测试密钥时，才验证 DeepSeek 或阿里云百炼。

每个 Bug 必须先添加能复现问题的失败测试，再修复实现。

关键规则要求完整分支覆盖：登录和权限、消息幂等、语法纠正频率、SM-2 评分、记忆删除与冲突。

## 6. 模块设计

### 6.1 System

提供：

- `GET /api/health`：进程存活；
- `GET /api/ready`：检查必要配置及 MySQL、Redis 连接；
- Request ID；
- 统一 JSON 成功和错误结构。

普通响应：

```json
{ "data": {}, "requestId": "01..." }
```

错误响应：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数不正确",
    "details": []
  },
  "requestId": "01..."
}
```

生产错误不返回堆栈、SQL、密钥和厂商原始响应。

### 6.2 Account

功能：邮箱密码直接注册、登录、退出、获取当前用户、修改资料。注册不经过邮箱验证码。

```text
POST  /api/v1/auth/email-code
POST  /api/v1/auth/register
POST  /api/v1/auth/login
POST  /api/v1/auth/logout
GET   /api/v1/me
PATCH /api/v1/me/profile
```

- 邮箱统一转为小写并去除首尾空格；
- 密码使用 Argon2id；
- 登录创建随机 Session ID，并写入 HttpOnly、Secure、SameSite=Lax Cookie；
- Session 默认 30 天，登录时轮换，退出立即删除；
- 注册和登录按 IP 与邮箱限流；
- `englishLevel` 只允许 `A1 | A2 | B1 | B2 | C1 | C2`；
- 修改类接口验证 Origin，并只接受 JSON。

### 6.3 Conversation

功能：创建话题、保存消息、AI 流式回复、翻译、“怎么表达”和语法纠正。

```text
POST /api/v1/conversations
GET  /api/v1/conversations
GET  /api/v1/conversations/:id/messages
POST /api/v1/conversations/:id/messages/stream
POST /api/v1/messages/:id/translation
```

流式请求使用 `fetch()` + POST SSE。事件协议：

```text
message.start
message.delta
correction.ready
message.done
error
```

客户端必须提供 `clientRequestId`。唯一索引防止网络重试生成重复消息。

流式处理顺序：

1. 保存用户消息；
2. 创建 `streaming` AI 消息；
3. 输出增量，但不逐 token 写数据库；
4. 完成后一次性保存正文和用量；
5. 连接断开时 Abort 上游，并将消息标记为 `interrupted`。

语法规则通过 `grammar_error_patterns` 数据库状态决定。模型只报告固定类型的候选错误，无权决定是否向用户展示纠正。

一期固定 16 类错误：主谓一致、时态、冠词、单复数、可数/不可数、介词搭配、形容词/副词、比较级、代词、不定式/动名词、情态动词形式、重复否定、句子残缺、中式语序、`there be`/`have` 和连接词重复。

- 同一用户按错误类型跨会话累计；
- 同一条用户消息、同一类型只累计一次，但保留该类型下所有具体错误；
- 第 1 条消息静默，第 2 条消息通过 `correction.ready` 展示全部具体错误，之后静默；
- 多个类型同时达到第 2 次时全部展示；
- 主聊天和结构化语法分析并行，分析失败不影响主回复；
- 用户主动询问语法时由主回复直接回答，不进入主动纠正计数。

### 6.4 Vocabulary

功能：收藏表达、补全词义音标、保留消息上下文、生成复习题、自动评分和 SM-2。

```text
GET    /api/v1/vocabularies
POST   /api/v1/vocabularies
DELETE /api/v1/vocabularies/:id
GET    /api/v1/reviews/today?limit=10
POST   /api/v1/reviews/:vocabularyId/answer
```

同一用户的相同 `normalized_expression` 只保留一条主记录，再次遇见时追加上下文。

一期复习采用“英文表达 → 心里回忆中文释义”的轻量交互。复习卡返回英文、音标、中文释义和例句，客户端先隐藏答案；用户查看后只提交回忆结果枚举，服务端固定映射为 SM-2 分数：

| 结果 | 含义 | 分数 |
|---|---|---:|
| `again` | 没想起 | 0 |
| `hard` | 看到答案后认识 | 2 |
| `good` | 不看答案想起来 | 3 |
| `easy` | 很快想起含义和用法 | 5 |

答题请求只接受 `{ result, clientRequestId }`，不接受客户端提交数字评分。相同 `clientRequestId` 重放已有结果，不重复推进复习状态；`again` 由客户端放回本轮队尾。

生词来源消息必须属于当前用户，选中内容必须存在于消息正文。词汇补全使用 `generateText + Output.object + Zod`，失败限重试一次。聊天模型不挂载词汇 Tool；对话中的中文表达由 `ConversationService.extractEmbeddedChineseExpressions()` 确定性检测，支持 `How do I say "散心" in English`、`for "散心"`、`"散心" means ...` 及普通英文句子夹中文。服务端以后台 Promise 执行 `enrichExpression() → addFromConversation()`，不等待任务完成就继续聊天流；生成或入库失败只记录 warning。

### 6.5 Memory

```text
GET    /api/v1/memories
PATCH  /api/v1/memories/:id
DELETE /api/v1/memories/:id
```

记忆类型：

- `profile`：长期；
- `preference`：长期有效；
- `significant_fact`：长期；
- `short_term`：默认 7 天。

Worker 每 20 分钟巡检一次。按用户和会话统计已完成且未扫描的用户消息：不足 10 条不处理；合格会话每轮读取最早最多 20 条，只调用一次 AI，并最多改变两条记忆。

AI 返回一至两个最终准入决策；没有合格记忆时返回一个 `shouldSave=false` 决策，并且始终不输出原文。服务端校验来源、秘密、明确性并复算准入分后才能落库；新建的 `content` 取数据库来源消息原文，同 key 更新只修改 `summary` 和来源。长期记忆不自动过期，短期记忆只允许 7、14 或 30 天。

一期后台任务使用 MySQL `background_jobs` + TEGG Schedule，不引入 BullMQ。

### 6.6 Learning Summary

```text
GET /api/v1/learning-summaries/today
GET /api/v1/learning-summaries?cursor=2026-08-11&limit=20
GET /api/v1/learning-summaries/:date
```

每日小结固定按 `Asia/Shanghai` 自然日聚合。客观指标来自消息、AI 用量、语法错误、词汇和复习记录，写入 `metrics_json`；AI 只读取结构化指标和有限语法示例，生成 `headline`、`highlights`、`improvements`、`nextSteps`，写入 `content_json`，不读取或保存完整聊天历史。

`(user_id, summary_date)` 唯一。`source_version` 是指标快照的 SHA-256；源数据未变化时不重复调用 AI。今日接口会按需生成，Worker 每 20 分钟刷新最近两天有活动的用户，并在进入次日后固化历史小结。AI 失败时使用确定性模板降级。所有日期边界先转换为 UTC 查询区间，数据库时间仍统一存 UTC。

### 6.7 AI

业务模块只依赖：

```ts
interface ProductAIService {
  chat(input: ChatInput): AsyncIterable<ChatEvent>;
  analyzeGrammar(input: GrammarInput): Promise<DetectedError[]>;
  translate(input: TranslateInput): Promise<Translation>;
  explainExpression(input: ExpressionInput): Promise<ExpressionInfo>;
  enrichVocabulary(input: VocabularyInput): Promise<VocabularyInfo>;
  extractMemories(input: MemoryInput): Promise<MemoryExtractionResult>;
}
```

Prompt 固定按以下顺序组装：

1. 朋友式聊天规则；
2. 固定角色灵魂；
3. 当前有效用户记忆；
4. CEFR 难度约束；
5. 当前话题和最近消息。

动态内容以有边界的结构化数据注入，不能覆盖系统规则。AI SDK 和厂商事件在 Provider 层转换为产品自己的 `ChatEvent`。

运行时选择由 `AI_TEXT_PROVIDER` 明确控制：

- `development`：本地确定性实现，不访问外部模型；
- `bailian`：通过 `@ai-sdk/alibaba` 使用 `BAILIAN_MODEL`，默认 `qwen3.7-flash`；
- `deepseek`：通过 `@ai-sdk/deepseek` 使用 `DEEPSEEK_MODEL`，默认 `deepseek-chat`；
- 翻译是独立模型用途：外部 AI 模式下固定通过百炼使用 `BAILIAN_TRANSLATION_MODEL`，默认
  `qwen3.7-flash`，并关闭 reasoning；其他能力继续遵循 `AI_TEXT_PROVIDER`；
- 生产环境未设置 `AI_TEXT_PROVIDER` 时默认使用 `deepseek`；翻译仍按独立用途走百炼。
  缺少相应密钥时直接报告不可用，不降级到开发实现。

业务模块看不到 AI SDK、DeepSeek 或百炼类型。Provider 只把 `fullStream` 中的文本增量、工具事件、完成原因和 Token 用量转换成稳定的产品事件。当前 `ai_usage_logs` 记录成功完成的聊天调用；欢迎语用量、失败调用延迟和错误码在监控切片补充。

## 7. 数据库

首批账户和对话闭环：

| 表 | 关键字段 |
|---|---|
| `users` | id, email, password_hash, status, created_at, updated_at |
| `user_profiles` | user_id, display_name, age, occupation, english_level |
| `conversations` | id, user_id, topic, status, memory_dirty_at, next_message_sequence |
| `messages` | id, conversation_id, sequence, role, status, content, translation, correction_json, client_request_id |
| `ai_usage_logs` | message_id, user_id, conversation_id, task, provider, model, input_tokens, output_tokens, status |
| `daily_chat_token_usages` | user_id, usage_date, token_count, created_at, updated_at |
| `daily_learning_summaries` | user_id, summary_date, timezone, status, source_version, metrics_json, content_json, AI usage |
| `grammar_error_patterns` | id, user_id, error_type, occurrence_count, corrected_at |
| `grammar_error_occurrences` | id, pattern_id, user_message_id, details_json |

后续业务表：

| 表 | 用途 |
|---|---|
| `vocabularies`、`vocabulary_contexts` | 生词和来源上下文（已实现） |
| `review_states`、`review_logs` | SM-2 和答题依据（已实现） |
| `memories`、`memory_sources`、`memory_change_logs` | 记忆原文、习惯/事实总结及变更审计 |
| `voice_recordings`、`speech_audio_assets`、`message_audios` | 已下线语音功能的历史表，仅保留数据兼容，不再由运行时代码访问 |
| `background_jobs` | 记忆与清理任务 |

主键使用应用生成的 ULID 字符串，时间统一存 UTC `DATETIME(3)`。

重要唯一索引：

```text
users(email)
messages(conversation_id, client_request_id)
messages(conversation_id, sequence)
vocabularies(user_id, normalized_expression)
grammar_error_patterns(user_id, error_key)
review_states(vocabulary_id)
```

生产环境禁止使用 `realm.sync()` 自动修改结构，只执行已提交的 Migration。

## 8. 配置与安全

配置通过环境变量注入，启动时校验，禁止把生产密钥提交到仓库。

```text
APP_KEYS
MYSQL_HOST MYSQL_PORT MYSQL_DATABASE MYSQL_USER MYSQL_PASSWORD
REDIS_HOST REDIS_PORT REDIS_PASSWORD
AI_TEXT_PROVIDER
DASHSCOPE_API_KEY BAILIAN_MODEL BAILIAN_TRANSLATION_MODEL BAILIAN_BASE_URL
DEEPSEEK_API_KEY DEEPSEEK_MODEL DEEPSEEK_BASE_URL
DAILY_CHAT_TOKEN_LIMIT
DIRECTMAIL_*
```

所有数据查询必须带当前 `userId` 约束。对于不属于当前用户的资源统一返回 404，避免泄漏资源存在性。

当前 AI 日志记录 provider、model、tokens 和成功状态，不记录密码、Cookie、访问密钥及不必要的完整个人内容。延迟和失败错误码在监控切片加入。

## 9. 本地、测试与生产

本地开发：

```text
pnpm dev             Egg 开发进程
docker compose       MySQL + Redis
peper24-app          Vite，通过 /api 代理到 7001
```

测试：

```text
pnpm test:unit
pnpm test:integration
pnpm test
pnpm coverage
```

CI：

```text
lint
→ TypeScript build
→ unit tests
→ 启动 MySQL / Redis
→ migration
→ integration tests
→ production build
```

生产 Docker Compose：

```text
nginx
web
api
worker
mysql
redis
```

API 与 Worker 使用同一镜像。部署时先执行 Migration，再替换 API；MySQL 独立持久化并执行每日备份。

## 10. TDD 实施顺序

1. System：健康检查、统一错误、Request ID；
2. Infrastructure：配置、MySQL、Redis、Migration；
3. Account：直接注册、登录、Session、个人资料；
4. Conversation：会话、消息、Fake AI 流式协议、幂等（已完成）；
5. AI：DeepSeek/百炼可配置 Provider、分层 Prompt、真实文字聊天和用量记录（已完成）；
6. Grammar：并行分析、固定分类、第二次纠正和多纠正重放（已完成）；
7. Vocabulary：收藏、词义补全、工具调用、复习和 SM-2（已完成）；
8. Memory：提取、冲突、过期、Prompt 注入和用户管理（业务切片已完成）；
9. Learning Summary：上海自然日聚合、结构化 AI 小结、今日与历史 API（已完成）；
10. Worker、限流、监控、备份和部署。

每个步骤都应形成可运行、可测试、可独立验收的垂直切片。
