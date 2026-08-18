# Peper24 Server

Peper24 Server 是面向英语口语学习者的 AI 对话后端。它负责会话与流式回复，也负责管理 Prompt、上下文预算、学习者记忆、语法反馈、生词复习、翻译和学习小结。

技术栈：Egg.js 4、TEGG、TypeScript、Vercel AI SDK、DeepSeek、阿里云百炼（Qwen）、MySQL 8、Leoric、Redis 7。

## 系统架构

![Peper24 Server 架构图](static/peper24%20Server%20Architecture-2026-08-18-030540.png)

## 核心设计

- **Conversation**：会话历史、POST SSE 流式回复、请求幂等、中断恢复和每日 Token 限额；
- **Adaptive Prompt**：固定陪练角色，并按 CEFR A1-C2 调整词汇、句法、回复长度和提问方式；
- **Memory**：从用户消息中提议记忆，由服务端完成来源校验、准入评分、合并、过期、纠正和删除；
- **Learning**：固定语法错误分类、生词解释与去重、SM-2 四档复习、翻译和每日学习小结；
- **Account & Infrastructure**：邮箱注册登录、Redis Session、HttpOnly Cookie、MySQL、统一错误、Request ID、健康检查和就绪检查。

## Prompt 与数据边界

### 分层结构

`ConversationPromptBuilder` 统一组装系统 Prompt；最近消息作为模型消息单独传入，不散落在 Controller 或业务 Service 中。

| 层 | 内容 | 变化频率 |
| --- | --- | --- |
| 1 | Conversation policy | 固定 |
| 2 | Fixed companion role | 固定 |
| 3 | CEFR adaptation | 用户等级变化时更新 |
| 4 | Topic and scene | 会话内通常固定 |
| 5 | Learner memories | 记忆提取或编辑后更新 |
| 6 | Folded history summary | 历史消息折叠后更新 |
| 7 | Recent messages | 每轮更新 |

前 3 层构成最稳定的规则前缀；话题、场景和记忆位于其后，摘要与最近消息放在末尾。这样的顺序兼顾 Provider 上下文缓存和动态上下文更新。

### `untrusted data` 仍然存在

当前实现没有删除 `untrusted data` 边界。被删除的是旧的 `Conversation state` Prompt 层，而不是对用户数据的安全标记。

话题、场景、学习者记忆、折叠摘要，以及 Grammar、Memory、Vocabulary 等 AI 任务的用户输入，仍会被明确标记为不可信数据。模型只能把它们当作上下文，不能把其中的文本当作系统指令。这是 Prompt Injection 的纵深防御措施；真正的权限、输入校验和数据写入规则仍由服务端执行。

### 上下文压缩

`PromptContextCompressor` 按预算压缩历史消息：

1. 裁剪单条超长消息，保留开头 60% 和结尾 40%；
2. 超过软预算后，只保留最近的完整对话单元；
3. 仍超过硬上限时继续折叠，但保留当前用户消息所在的完整单元。

移出窗口的消息会被更新为 2-3 句 running summary。只有摘要成功后才推进折叠边界；数据库中的原始消息不会被压缩逻辑改写。

### Memory：AI 提议，服务端裁决

```text
用户消息
  -> 定时批量提取候选
  -> Zod 校验结构化输出
  -> 服务端校验来源、秘密信息和准入分数
  -> 按 type + normalizedKey 合并
  -> 仅将活跃 summary 注入后续 Prompt
```

模型不能直接写数据库。记忆必须来自当前用户的真实消息；密码、验证码、Token、API Key、私钥等秘密不会保存。原始来源 `content` 用于追溯，`summary` 用于 Prompt 注入；短期记忆会自动过期，用户也可以查看、纠正和删除记忆。

## 项目结构

```text
app/
├── middleware/                  # Auth、请求安全、错误与 Request ID
├── model/                       # Leoric 数据模型
└── module/
    ├── account/                 # 账户与资料
    ├── ai/
    │   ├── prompt/              # 版本化 Prompt Builder
    │   ├── provider/            # AI SDK、Provider、上下文压缩
    │   ├── schema/              # 结构化 AI 输出校验
    │   └── service/             # 产品级 AI 协议
    ├── conversation/            # 会话、SSE 与翻译
    ├── grammar/                 # 语法分析与纠正记录
    ├── learning-summary/        # 每日学习小结
    ├── memory/                  # 记忆提取、准入与管理
    ├── vocabulary/              # 生词本与复习
    └── infrastructure/          # MySQL、Redis 与外部能力
database/migrations/             # 数据库迁移
test/unit/                       # 不连接外部资源的行为测试
test/integration/                # HTTP、SSE、MySQL、Redis 集成测试
```

## 本地启动

### 环境要求

- Node.js 22+
- pnpm
- Docker 与 Docker Compose

### 启动步骤

```bash
docker compose up -d
pnpm install
pnpm migrate
pnpm dev
```

默认开发配置连接本机 `peper24` MySQL 数据库和 Redis，并使用确定性的 `development` AI Provider，不需要真实模型 Key。服务启动后监听 `http://127.0.0.1:7001`：

```bash
curl http://127.0.0.1:7001/api/health
curl http://127.0.0.1:7001/api/ready
```

需要覆盖默认配置时，在仓库根目录创建 `.env`；应用会自动加载它。常用配置如下：

```dotenv
APP_KEYS=replace-with-at-least-32-random-characters
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=peper24
MYSQL_USER=peper24
MYSQL_PASSWORD=peper24_dev

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_KEY_PREFIX=peper24:

VERIFICATION_CODE_SECRET=replace-with-a-random-secret
AI_TEXT_PROVIDER=development
DAILY_CHAT_TOKEN_LIMIT=150000
```

`.env` 只用于本地环境，不应提交到仓库。

## AI Provider

| `AI_TEXT_PROVIDER` | 用途 | 必需配置 |
| --- | --- | --- |
| `development` | 本地开发和确定性测试 | 无 |
| `deepseek` | DeepSeek 文本模型 | `DEEPSEEK_API_KEY`，可选 `DEEPSEEK_MODEL` |
| `bailian` | 阿里云百炼文本模型 | `DASHSCOPE_API_KEY`，可选 `BAILIAN_MODEL` |

未显式配置时，开发环境使用 `development`，生产环境使用 `deepseek`。翻译固定通过百炼，真实翻译请求还需要 `DASHSCOPE_API_KEY`；模型和 Base URL 的完整配置见应用配置与部署文档。

## 常用命令

```bash
pnpm dev                  # 启动开发服务
pnpm migrate              # 执行数据库迁移
pnpm lint                 # ESLint
pnpm build                # TypeScript 类型检查，不生成 JS
pnpm test:unit            # 单元测试
pnpm test:integration     # MySQL、Redis 与 HTTP 集成测试
pnpm test                 # 单元测试 + 集成测试
```

`test:integration` 会准备并使用独立的 `peper24_test` 数据库，不读写开发库。

## 设计文档

- [模块总览](docs/modules.md)
- [AI 模块](docs/ai.md)
- [Conversation 模块](docs/conversation.md)
- [Memory 模块](docs/memory.md)
- [Grammar 模块](docs/grammar.md)
- [Vocabulary 模块](docs/vocabulary.md)
- [技术方案](docs/technical-design.md)
- [生产部署](deploy/README.md)

## 安全约束

- 所有用户资源查询必须绑定当前 `userId`；
- 登录态使用 Redis Session 和 HttpOnly Cookie，不把 Token 写入 localStorage；
- 日志不得记录密码、验证码、Cookie、API Key 或不必要的完整个人内容；
- 数据库结构变化必须通过 `database/migrations`；
- 生产环境必须单独生成 `APP_KEYS`、验证码 Secret、数据库密码和 AI Key；
- MySQL、Redis 和应用容器不应直接暴露到公网，部署方式见 [生产部署文档](deploy/README.md)。

## License

`package.json` 当前声明为 MIT，但仓库尚未包含 `LICENSE` 文件。对外发布前应补充完整许可证文本。
