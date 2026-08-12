# Peper24 Server

Peper24 是一个面向英语口语学习者的 AI 对话服务端。它不只负责把消息发给模型，而是把长期稳定的 Prompt、受预算约束的会话上下文，以及可追溯、可纠正的用户记忆组合成一套完整的对话系统。

技术栈：Egg.js 4、TEGG、TypeScript、Vercel AI SDK、DeepSeek、MySQL 8、Leoric、Redis 7。

## 核心设计

### 1. 分层 Prompt：稳定规则在前，动态上下文在后

对话 Prompt 由 `ConversationPromptBuilder` 统一组装，长期 Prompt 不散落在 Controller 或业务 Service 中。

```text
① Conversation policy     固定对话规则与工具调用约束
② Fixed companion role    Peper 的角色、语气和关系设定
③ CEFR adaptation         A1-C2 难度、句长、词汇与提问策略
④ Topic and scene         当前话题与场景
⑤ Learner memories        当前用户的活跃记忆
⑥ Conversation state      会话级 one-liner 状态
⑦ Folded history summary  被折叠旧消息的运行摘要
⑧ Recent messages         最近原始消息窗口
```

前五层变化较慢，形成稳定前缀，便于模型提供方复用上下文缓存；会话状态、折叠摘要和最近消息放在后部，避免动态内容破坏稳定前缀。

所有来自用户、场景、记忆和摘要的数据都被明确标记为 **untrusted data**，只能用于理解上下文，不能被当作系统指令。这让 Prompt 分层同时承担产品行为约束和 Prompt Injection 边界。

CEFR 适配不是简单地把等级写进 Prompt：每个等级分别约束词汇范围、句法复杂度、回复长度、提问方式和适度挑战，让同一个陪练角色能稳定服务不同水平的学习者。

### 2. 上下文压缩：原文窗口 + 增量摘要

对话不会无限拼接历史消息。`PromptContextCompressor` 使用三段式预算控制：

1. 单条超长消息先裁剪，保留开头 60% 和结尾 40%；
2. 超过软预算后，只保留最近的完整对话单元；
3. 仍超过硬上限时继续折叠，但永远保留当前用户消息所在的完整单元。

被移出窗口的消息由独立 Prompt 更新为 2-3 句 running summary。摘要成功后才推进折叠边界；摘要失败则沿用旧摘要，不把失败误记为已处理。数据库中的原始消息不被压缩逻辑改写。

### 3. Memory：AI 提议，服务端裁决

记忆系统刻意不让模型直接写数据库：

```text
用户消息
  -> App 每 20 分钟为当前登录用户触发批量提取
  -> Zod 校验结构化输出
  -> 服务端 Grounding 与准入评分
  -> 按 type + normalizedKey 合并
  -> 仅将活跃 summary 注入后续 Prompt
```

提取任务每批处理 10-20 条待扫描消息，模型最多提出两条候选。候选分为：

- `profile`：稳定身份、职业、居住地、家庭结构；
- `preference`：强且稳定的偏好、兴趣或习惯；
- `significant_fact`：重要经历、成就或长期目标；
- `short_term`：跨会话有用但会过期的事项，支持 7、14、30 天。

模型为稳定性、未来价值、个人重要性和明确程度分别打分，也标记一次性事件、上下文局部信息等扣分项。服务端随后重新计算准入分，并强制执行以下规则：

- 来源必须是当前用户的真实消息，且至少命中本批待处理消息；
- 推断、假设和明确度不足的内容拒绝保存；
- 密码、验证码、Token、API Key、私钥等秘密拒绝保存；
- 普通长期记忆必须达到阈值，用户明确要求“记住”只能绕过分数，不能绕过秘密和来源校验；
- `content` 保留首次来源原文用于追溯，`summary` 才用于 Prompt 注入，AI 合并时不能覆盖原始来源；
- 同一语义槽通过 `type + normalizedKey` 合并，短期记忆自动过期，用户删除采用墓碑状态。

用户可以通过 API 触发提取、查看、纠正和删除记忆。这里的目标不是“尽可能多地记住”，而是只保留未来对话真正有价值、来源清楚且用户可控制的信息。

## 其他能力

- Account：邮箱注册、登录、Redis Session、HttpOnly Cookie、Argon2id；
- Conversation：会话与消息历史、POST SSE 流式回复、请求幂等和中断恢复；
- Vocabulary：表达解释与工具入库、上下文去重、SM-2 四档复习；
- Grammar：固定错误分类、结构化分析、纠正记录与幂等重放；
- Translation：语言识别、结构化翻译、消息级缓存与资源权限校验；
- Learning Summary：按上海自然日聚合聊天、语法、词汇和复习数据；
- AI Usage：记录 Provider、模型和 Token 用量，按 UTC 日限制聊天额度；
- Infrastructure：MySQL、Leoric、Redis、统一错误、Request ID、健康与就绪检查。

## 项目结构

```text
app/
├── middleware/                  # Auth、请求安全、错误与 Request ID
├── model/                       # Leoric 数据模型
└── module/
    ├── ai/
    │   ├── prompt/              # 版本化 Prompt Builder
    │   ├── provider/            # AI SDK、Provider、上下文压缩
    │   ├── schema/              # 结构化 AI 输出校验
    │   └── service/             # 稳定的产品 AI 协议
    ├── memory/                  # 提取、准入、存储与用户管理
    ├── conversation/            # 会话和 SSE 编排
    ├── vocabulary/              # 生词本与复习
    ├── grammar/                 # 语法分析
    ├── learning-summary/        # 每日学习小结
    ├── account/                 # 账户与资料
    └── infrastructure/          # MySQL、Redis 与外部能力实现
database/migrations/             # 数据库迁移
test/unit/                       # 不连接外部资源的行为测试
test/integration/                # HTTP、SSE、MySQL、Redis 集成测试
```

更深入的说明见 [AI 设计](docs/ai.md)、[Memory 设计](docs/memory.md) 和 [技术方案](docs/technical-design.md)。

## 本地启动

要求 Node.js 20.18+、pnpm 和 Docker。

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm migrate
pnpm dev
```

Egg 不会自动读取 `.env`，请通过 shell、direnv 或 IDE 注入环境变量。本地默认使用确定性的 `development` AI Provider；联调真实模型时再设置 `AI_TEXT_PROVIDER=deepseek` 和自己的 `DEEPSEEK_API_KEY`。

服务默认监听 `http://127.0.0.1:7001`：

```bash
curl http://127.0.0.1:7001/api/health
curl http://127.0.0.1:7001/api/ready
```

## 常用命令

```bash
pnpm dev
pnpm migrate
pnpm lint
pnpm build
pnpm test:unit
pnpm test:integration
pnpm test
```

`pnpm build` 只执行 TypeScript 类型检查，不在源码目录生成 JavaScript。`test:integration` 使用独立的 `peper24_test` 数据库，不读写开发库。

## 配置与安全

- 仓库只提交 `.env.example` 占位配置；`.env`、证书、私钥、数据库导出、备份和本地 Prompt 调试样本均被忽略；
- 生产环境必须单独生成 `APP_KEYS`、验证码 Secret、MySQL/Redis 密码和 AI Key；
- 日志不得记录密码、验证码、Cookie、访问密钥或不必要的完整个人内容；
- 生产部署参考 [deploy/README.md](deploy/README.md)，MySQL、Redis 和应用容器不直接暴露到公网。

## License

当前仓库尚未声明开源许可证。未经许可，不代表授予复制、修改或分发权利。
