# Peper24 Server 架构图

> 本文件包含 Mermaid 源码，可在支持 Mermaid 的编辑器（VS Code、Typora、GitHub）中直接渲染。
> 渲染命令（可选）：`mmdc -i docs/architecture.md -o docs/architecture.svg -t default`

## 总体架构

```mermaid
flowchart TB
    subgraph CLIENT["客户端层"]
        WEB["peper24-app<br/>(Vite Web App)"]
        TTS["浏览器本地 TTS<br/>(消息朗读，不经过服务端)"]
    end

    subgraph EDGE["接入层"]
        NGINX["Nginx<br/>(HTTPS 终结 / 反向代理)"]
    end

    subgraph APP["应用层 — Egg.js 4 + TEGG + TypeScript（模块化单体）"]
        direction TB

        subgraph MW["Middleware（跨模块 HTTP 关注点）"]
            AUTH["auth<br/>Session Cookie → userId"]
            ERR["errorHandler<br/>统一错误结构 + Request ID"]
            REQCTX["requestContext<br/>Request ID"]
            SEC["requestSecurity<br/>Origin / 限流 / 防篡改"]
        end

        subgraph MOD["业务模块（Controller → Service → Ports）"]
            direction LR
            SYS["system<br/>Health / Readiness"]
            ACC["account<br/>注册 / 登录 / Session / 资料"]
            CONV["conversation<br/>会话 / 流式消息 / 翻译 / 场景"]
            GRAM["grammar<br/>16 类语法错误 / 纠正策略"]
            VOCAB["vocabulary<br/>生词 / SM-2 复习 / 词义补全"]
            MEM["memory<br/>记忆提取 / 合并 / 过期 / 管理"]
            LS["learning-summary<br/>每日小结 / 指标聚合"]
        end

        subgraph AI["AI 模块（核心抽象层）"]
            direction TB
            PAI["ProductAIService<br/>（抽象类，7 个能力方法）"]
            AISDK["AISDKProductAIService<br/>（生产 Adapter）"]
            TMP["TextModelProvider / ConfiguredTextModelProvider<br/>（按用途选模型）"]
            GEN["AISDKTextGenerator<br/>（fullStream → ChatEvent）"]
            PR["prompt/ · schema/ · PromptContextCompressor"]
        end

        subgraph INFRA["infrastructure（可注入基础设施实现）"]
            direction TB
            DBREPO["Mysql*Repository<br/>（Conversation / User / Vocabulary / Memory / LearningSummary）"]
            REDISSTORE["RedisSessionStore<br/>RedisClientService"]
            UTIL["Argon2PasswordHasher<br/>UlidGenerator / SystemClock"]
        end
    end

    subgraph DATA["数据层"]
        MYSQL[("MySQL 8<br/>Leoric + Migrations")]
        REDIS[("Redis 7<br/>Session / 限流 / 短期锁")]
    end

    subgraph EXTERNAL["外部 AI 服务"]
        DS["DeepSeek API<br/>(deepseek-chat)"]
        BL["阿里云百炼 DashScope<br/>(qwen3.7-flash)"]
    end

    subgraph WORKER["Worker（同一镜像，运行角色区分）"]
        SCHED["TEGG Schedule<br/>每日小结生成<br/>记忆/清理任务"]
    end

    WEB -- "HTTPS + JSON / POST SSE" --> NGINX
    WEB -. "语音合成" .-> TTS
    NGINX -- "/api 代理 → 7001" --> MW

    MW --> MOD
    MOD --> PAI
    CONV --> AISDK
    GRAM --> AISDK
    VOCAB --> AISDK
    MEM --> AISDK
    LS --> AISDK
    PAI --> AISDK
    AISDK --> TMP
    TMP --> GEN
    GEN --> PR

    MOD --> INFRA
    INFRA --> MYSQL
    INFRA --> REDIS

    GEN -- "@ai-sdk/deepseek" --> DS
    GEN -- "@ai-sdk/alibaba" --> BL

    WORKER --> LS
    WORKER --> MEM
    WORKER --> MYSQL

    classDef client fill:#e8f4fd,stroke:#2b6cb0,stroke-width:1px
    classDef edge fill:#fefcbf,stroke:#b7791f,stroke-width:1px
    classDef app fill:#f0fff4,stroke:#276749,stroke-width:1px
    classDef ai fill:#faf5ff,stroke:#6b46c1,stroke-width:1px
    classDef infra fill:#fff5f5,stroke:#c53030,stroke-width:1px
    classDef data fill:#edf2f7,stroke:#4a5568,stroke-width:2px,stroke-dasharray:5 3
    classDef ext fill:#fff,stroke:#718096,stroke-width:1px,stroke-dasharray:5 3
    classDef worker fill:#fffaf0,stroke:#c05621,stroke-width:1px

    class WEB,TTS client
    class NGINX edge
    class MW,MOD app
    class AI,PAI,AISDK,TMP,GEN,PR ai
    class INFRA,DBREPO,REDISSTORE,UTIL infra
    class MYSQL,REDIS data
    class DS,BL ext
    class SCHED worker
```

## 核心调用链：一次流式对话

```mermaid
sequenceDiagram
    participant W as Web App
    participant N as Nginx
    participant C as ConversationController
    participant S as ConversationService
    participant G as GrammarService
    participant V as VocabularyService
    participant A as ProductAIService
    participant P as Provider(AISDK)

    W->>N: POST /conversations/:id/messages/stream (SSE)
    N->>C: 请求（含 Session Cookie + clientRequestId）
    C->>S: streamMessage(content, clientRequestId)
    par 主聊天流
        S->>A: chat(input) — AsyncIterable<ChatEvent>
        A->>P: fullStream (DeepSeek / 百炼)
        P-->>S: message.start / delta / correction.ready / done
        S-->>C: SSE 事件转发
        C-->>W: message.delta 等事件
        S-->>S: 完成后一次性落库正文 + token 用量
    and 并行语法分析
        S->>G: analyzeGrammar(content)
        G->>A: analyzeGrammar(input)
        A-->>G: DetectedError[]
        G-->>S: 按 grammar_error_patterns 决定是否展示
    and 后台词汇增强（不阻塞）
        S->>V: enrichVocabulary(text) (后台 Promise)
        V->>A: enrichVocabulary(input)
        A-->>V: VocabularyInfo → 入库
    end
    S-->>C: message.done（含 usage）
    C-->>W: SSE 结束
```

## 分层职责速查

| 层 | 职责 | 对应目录 |
|---|---|---|
| Middleware | 认证、错误、Request ID、安全 | `app/middleware/` |
| Controller | 协议转换、Schema 校验、身份上下文 | `app/module/*/controller/` |
| Service | 业务规则与用例编排（单测主对象） | `app/module/*/service/` |
| Ports | 可注入抽象接口（DI Token） | `app/module/*/service/*Ports.ts` |
| Model | Leoric 数据库映射 | `app/model/` |
| Infrastructure | MySQL / Redis / 工具实现 | `app/module/infrastructure/` |
| AI Provider | AI SDK 与厂商类型隔离 | `app/module/ai/provider/` |
| Prompt | 版本化 Prompt 模板 | `app/module/ai/prompt/` |
| Schema | Zod 输入输出与 AI 结构校验 | `app/module/*/schema/`、`app/module/ai/schema/` |
| Migrations | 唯一的生产结构变更入口 | `database/migrations/` |
| Schedule | Worker 定时任务 | `app/module/*/schedule/` |
