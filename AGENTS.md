# Peper24 Server 开发规则

技术方案以 `docs/technical-design.md` 为准。产品规则来源于配套产品设计文档。

## 项目目录

```text
app/
├── middleware/             # auth、统一错误、Request ID
├── model/                  # Leoric 数据库映射
└── module/
    ├── account/            # controller、service、schema
    ├── conversation/
    ├── vocabulary/
    ├── memory/
    ├── ai/                 # service、provider、prompt、schema
    └── infrastructure/     # database、redis

database/migrations/        # Leoric Migration
test/unit/                  # 不连接外部资源
test/integration/           # HTTP、MySQL、Redis、SSE
test/support/               # Fake、Fixture、测试工具
```

按业务需要逐步建立目录，不创建没有代码和测试的空模块。

## 职责和依赖

- Middleware 只处理跨模块 HTTP 关注点，不实现业务规则。
- Controller 只做协议转换、Schema 校验、身份上下文和响应；不得直接读写数据库。
- Service 负责业务规则和用例编排，是单元测试的主要对象。
- Schema 使用 Zod，只处理结构、类型、格式和长度校验，不代替业务规则。
- `app/model` 是 Leoric 数据库映射，不向 Controller 直接暴露，不包含 HTTP 和第三方 SDK 逻辑。
- Infrastructure 实现数据库、Redis 等技术能力。
- AI SDK 和厂商类型只能出现在 `module/ai/provider` 内。
- 长期 Prompt 必须放在 `module/ai/prompt`，不得散落在 Controller。

依赖方向：

```text
middleware -> controller -> service -> model / 可注入基础设施接口
业务模块 -> ProductAIService -> provider -> vendor SDK
```

Service 不得直接创建 Redis、邮件或 AI 客户端。外部能力使用可注入抽象类作为 TEGG DI Token，测试使用 Fake 实现。

跨业务模块只能引用对方明确公开的入口，不引用内部 Controller、Schema 或具体 Adapter。

## TDD

所有业务功能遵循 Red → Green → Refactor：

1. 先写描述业务行为的失败测试；
2. 写最少实现使其通过；
3. 补边界、权限、幂等和并发测试；
4. 在测试保护下重构；
5. 最后增加真实 Adapter 和 HTTP 集成测试。

单元测试：

- 不启动 Egg；
- 不连接 MySQL、Redis；
- 不调用真实 AI 或邮件；
- 使用 InMemory Repository、FakeClock、FixedIdGenerator 和 Fake Provider；
- 不通过 Mock 内部私有方法来跳过真实业务行为。

集成测试使用独立测试资源，不允许连接开发或生产数据库。真实厂商契约测试不得进入默认测试命令。

修复 Bug 前必须先添加能够复现问题的失败测试。

## 数据和安全

- 所有表结构变化使用 `database/migrations`，生产禁止 `realm.sync()`。
- 所有用户资源查询都必须包含当前 `userId`。
- 登录使用 Redis Session + HttpOnly Cookie，不将 Token 写入 localStorage。
- 日志不得记录密码、验证码、Cookie、API Key 和不必要的完整个人内容。
- 时间统一存 UTC，API 使用 ISO 8601。
- 对外错误使用稳定错误码，不暴露堆栈、SQL 和厂商原始错误。

## 命名

- Controller：`<Resource>Controller`
- Service：`<Capability>Service`，复杂单一用例使用 `<UseCase>ApplicationService`
- Zod Schema：`<Action>Schema`
- HTTP 输入输出：`<Action>Request`、`<Action>Response`
- 基础设施实现按技术命名，例如 `RedisSessionStore`、`DeepSeekTextProvider`
- 测试文件：`*.test.ts`

## 完成标准

一项功能只有同时满足以下条件才算完成：

- 对应行为测试先于或伴随实现存在；
- unit tests 通过；
- 涉及 HTTP、数据库或 Redis时，相应 integration tests 通过；
- TypeScript build 和 lint 通过；
- 没有把密钥、真实用户数据或运行产物提交到仓库。
