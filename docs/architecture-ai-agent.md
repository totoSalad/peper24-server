# Peper24 AI Agent 架构设计图（五维度）

> 对应 `docs/ai.md`、`docs/technical-design.md` 与 `app/module/ai` 的实际实现。
> 所有图可直接在 [mermaid.live](https://mermaid.live) 或支持 Mermaid 的编辑器中渲染。

## 1. 错误处理

```mermaid
flowchart TB
    subgraph EDGE["HTTP 边界 — errorHandler middleware"]
        EH["统一 try/catch"]
        ZOD["ZodError<br/>→ VALIDATION_ERROR (400)"]
        APP["AppError<br/>→ 稳定错误码 + status (400~503)"]
        UNK["未知异常<br/>→ INTERNAL_ERROR (500)<br/>只记日志，不暴露堆栈/SQL/厂商错误"]
    end

    subgraph AIERR["AI 调用错误分类（AISDKTextGenerator）"]
        NET["网络错误码<br/>ECONNRESET / ETIMEDOUT / EPIPE /<br/>ENETUNREACH / ENOTFOUND …"]
        HTTP["HTTP 状态<br/>408 / 429 / ≥500 或 isRetryable"]
        RA["Retry-After 头解析<br/>（秒或 HTTP 日期）"]
        ABORT["AbortError / ResponseAborted<br/>客户端断开 → 不重试"]
        SCHEMA["NoObjectGeneratedError<br/>结构化输出解析/校验失败"]
    end

    subgraph RETRY["统一重试策略（retryTransientFailure，maxRetries=2）"]
        R1["第 1 次尝试"]
        R2["指数退避 1s / 2s<br/>±50% 随机抖动"]
        R3["第 2 次重试"]
        RAX["Retry-After > 5s<br/>→ 放弃重试，快速失败"]
        REPAIR["结构化输出失败：<br/>把解析错误追加进 prompt<br/>让模型自愈 JSON（仅 1 次）"]
    end

    subgraph STREAM["流式链路错误（chat）"]
        SE["fullStream 出现 error / abort part"]
        THROW["抛出 Error"]
        CATCH["ConversationService catch"]
        INT["interruptAssistant：<br/>消息标记 interrupted<br/>保留已生成内容 + 落库"]
        YERR["yield { type:'error',<br/>code:'AI_STREAM_FAILED', retryable:true }"]
    end

    subgraph ISOLATE["失败隔离（不阻塞主流程）"]
        G1["语法分析失败<br/>→ 空分析，主回复不受影响"]
        G2["后台词汇自动保存失败<br/>→ 仅记 warning"]
        G3["折叠摘要 LLM 失败<br/>→ 沿用 previousSummary，边界不推进"]
        G4["每日小结 AI 失败<br/>→ 确定性模板降级"]
        G5["翻译失败<br/>→ TRANSLATION_FAILED (502)"]
    end

    EH --> ZOD
    EH --> APP
    EH --> UNK
    APP --> AIERR
    AIERR --> RETRY
    AIERR --> ABORT
    RA --> RAX
    SCHEMA --> REPAIR
    RETRY --> STREAM
    STREAM --> YERR
    ISOLATE
```

## 2. 流程编排

```mermaid
flowchart TB
    subgraph ORCH["流式对话编排 — ConversationService.streamMessage"]
        ID["幂等检查<br/>clientRequestId 唯一索引"]
        ID -- "已存在且 completed" --> REPLAY["replay 已存消息<br/>（不重复调用 AI）"]
        ID -- "不存在" --> LIMIT["每日 Token 限额检查<br/>DAILY_CHAT_TOKEN_LIMIT"]
        LIMIT --> BEGIN["beginExchange 事务<br/>保存 user 消息 + 建 streaming 消息"]
        BEGIN --> PAR

        subgraph PAR["并行编排"]
            CHAT["主聊天流<br/>ai.chat() → AsyncIterable<ChatEvent>"]
            GRAM["并行语法分析<br/>ai.analyzeGrammar()<br/>.catch(→空分析)"]
            VOCAB["后台词汇增强<br/>extractEmbeddedChineseExpressions()<br/>确定性提取 ≤3 个中文表达<br/>enrichExpression → addFromConversation"]
        end

        CHAT --> SUM["summary.update 事件<br/>→ updateSummary 持久化折叠摘要"]
        CHAT --> DONE["message.done（含 usage）"]
        GRAM --> PREP["GrammarService.prepare<br/>按 grammar_error_patterns 决定是否展示"]
        PREP --> CORR["correction.ready 事件"]
        DONE --> COMPLETE["completeAssistant 事务<br/>正文 + 用量 + 纠正一次性落库"]
        COMPLETE --> EVENTS["yield message.done"]
    end

    subgraph MEMORY["记忆提取编排 — MemoryExtractionService（Worker/手动触发）"]
        M1["loadPendingMemoryGroups<br/>≥10 条 / 组 ≤20 条 / 最多 20 组"]
        M2["loadExtractionContext<br/>目标前 2 条 + target 完整消息"]
        M3["ai.extractMemories<br/>一次调用，最多 2 条决策"]
        M4["admitMemoryDecision 服务端复算<br/>来源校验 / 秘密拒绝 / 准入分门槛"]
        M5["applyCandidates<br/>normalizedKey 去重合并"]
        M6["markMessagesScanned<br/>成功或 shouldSave=false 都推进"]
        M1 --> M2 --> M3 --> M4 --> M5 --> M6
    end

    subgraph SUMMARY["每日小结编排 — LearningSummaryService（Schedule 24h / 按需）"]
        S1["aggregate 客观指标（消息/用量/错误/词汇/复习）"]
        S2["sourceVersion = SHA-256(metrics)<br/>源数据未变 → 不重复调用 AI"]
        S3["claim 行级抢占<br/>防并发重复生成"]
        S4["ai.generateDailyLearningSummary<br/>（失败 → 模板降级）"]
        S5["complete + finalizeBefore 固化历史"]
        S1 --> S2 --> S3 --> S4 --> S5
    end
```

## 3. 上下文管理

```mermaid
flowchart TB
    subgraph ASSEMBLE["Prompt 组装（固定顺序，动态内容有边界注入）"]
        P1["1. 朋友式聊天规则（系统规则）"]
        P2["2. 固定角色灵魂"]
        P3["3. 当前有效用户记忆<br/>memory.context(userId) → summary 注入<br/>content 原文不注入"]
        P4["4. CEFR 难度约束（A1~C2）"]
        P5["5. 当前话题 / 场景 / 最近消息"]
    end

    subgraph COMPRESS["消息窗口压缩 — PromptContextCompressor"]
        EST["estimateTokens 启发式<br/>CJK ≈1 token/字，其余 ≈4 字符/token<br/>仅用于窗口预算，不用于计费"]
        T1["Stage 0 单条裁剪<br/>超 2,000 token → 保留前 60% + 后 40%"]
        T2["Stage 2 软预算 12,000 token<br/>→ 按完整对话边界收缩<br/>只留最近 ≤30 条"]
        T3["Stage 3 硬上限 8,000 token<br/>→ 沿边界继续折叠<br/>当前用户消息永不折叠"]
        FOLD["折叠消息 → summarizeFolded<br/>LLM 增量生成 running summary"]
        FOLDOK["成功：summaryFoldedUntil 推进<br/>→ summary.update 事件 → 落库"]
        FOLDFAIL["失败：沿用 previousSummary<br/>边界不推进（降级不阻塞）"]
        CUT["裁剪点合法性：<br/>只能切在 assistant 消息之前<br/>（完整对话单元）"]
    end

    subgraph MEMINJ["记忆注入"]
        M["withMemories：<br/>learner + memories → LearnerContext"]
        M --> P3
    end

    ASSEMBLE --> CHATMODEL["streamText / generateText"]
    CHATMODEL --> COMPRESS
    EST --> T1 --> T2 --> T3 --> FOLD
    CUT -.约束.-> T2
    FOLD --> FOLDOK
    FOLD --> FOLDFAIL
```

## 4. 状态与持久化

```mermaid
stateDiagram-v2
    direction LR
    [*] --> active: 创建会话
    active --> streaming: 收到消息 + beginExchange
    streaming --> completed: completeAssistant<br/>一次性写正文/用量/纠正
    streaming --> interrupted: 客户端断开/上游错误<br/>interruptAssistant 保留已生成内容
    interrupted --> streaming: 同 clientRequestId 重试
    completed --> [*]

    state "记忆 (memories)" as memory {
        [*] --> active: applyCandidates
        active --> expired: 短期记忆 7/14/30 天
        active --> deleted: 软删除（墓碑）
        deleted --> active: 同 normalizedKey 重新激活
        active --> superseded: 预算淘汰（按准入分）
    }

    state "每日小结 (daily_learning_summaries)" as summary {
        [*] --> pending: claim 抢占
        pending --> completed: generate + complete
        completed --> finalized: finalizeBefore 固化历史
    }
```

```mermaid
flowchart LR
    subgraph PERSIST["持久化要点"]
        DB[("MySQL 8<br/>users / conversations / messages /<br/>vocabularies / review_states / memories /<br/>grammar_error_patterns /<br/>daily_learning_summaries / ai_usage_logs /<br/>background_jobs")]
        REDIS[("Redis 7<br/>session:{sid} → userId<br/>限流 / 短期锁")]
        IDEMP["幂等：<br/>messages(conversation_id, client_request_id) 唯一<br/>messages(conversation_id, sequence) 唯一"]
        CONVSUM["会话级运行摘要：<br/>conversations.summary + summary_folded_until<br/>跨请求持久化，替代丢失的旧消息"]
        TCACHE["翻译缓存：<br/>messages.translation 字段<br/>+ inFlight Map 并发合并"]
        USAGE["用量落库：<br/>ai_usage_logs（provider/model/tokens/status）<br/>daily_chat_token_usages"]
        MEMKEY["记忆去重：<br/>memories(user_id, normalized_key) 唯一<br/>content 保留首次原文"]
        TS["时间统一 UTC DATETIME(3)<br/>API 输出 ISO 8601"]
    end
```

## 5. 成本控制

```mermaid
flowchart TB
    subgraph MODEL["模型选择（按用途）"]
        M1["AI_TEXT_PROVIDER: deepseek / bailian"]
        M2["翻译固定走百炼<br/>BAILIAN_TRANSLATION_MODEL<br/>qwen3.7-flash + reasoning:none"]
        M3["词汇增强：纯英文 → reasoning:none<br/>（评测 30/30 正确，<1s）<br/>含中文 → 保留默认推理"]
        M4["每日小结 / 记忆提取：reasoning:none"]
    end

    subgraph BUDGET["上下文预算（常量）"]
        B1["软预算 12,000 token"]
        B2["硬上限 8,000 token"]
        B3["窗口 ≤30 条消息"]
        B4["单条 ≤2,000 token（超则裁剪）"]
    end

    subgraph LIMIT["每日额度"]
        L1["DAILY_CHAT_TOKEN_LIMIT（默认 150,000）"]
        L2["daily_chat_token_usages 累计"]
        L3["超限 → 429 DAILY_CHAT_TOKEN_LIMIT_EXCEEDED"]
    end

    subgraph RETRYCOST["重试与修复预算"]
        R1["瞬态错误最多重试 2 次"]
        R2["Retry-After > 5s → 不重试"]
        R3["结构化输出修复仅 1 次"]
    end

    subgraph BATCH["批量与去重"]
        X1["记忆提取：<br/>≥10 条才处理 / 组 ≤20 条<br/>每组只调 1 次 AI / 最多 2 条决策"]
        X2["每日小结：<br/>sourceVersion SHA-256 去重<br/>源数据未变不调 AI"]
        X3["翻译：DB 缓存 + inFlight 并发合并<br/>同消息只调一次"]
        X4["词汇：normalized_expression 唯一<br/>重复遇见只追加上下文"]
    end

    subgraph MONITOR["可观测"]
        Y1["aiLogger: [ai-generate] start/done<br/>记录 input/output tokens"]
        Y2["[ai-context] folded 条数日志"]
        Y3["ai_usage_logs 表持久化用量"]
    end
```

---

## 分层职责速查（AI 相关）

| 关注点 | 位置 | 机制 |
|---|---|---|
| 错误处理 | `AISDKTextGenerator` / `errorHandler` / `ConversationService` | 错误分类 → 重试 → 隔离 → 降级 → 稳定错误码 |
| 流程编排 | `ConversationService` / `MemoryExtractionService` / `LearningSummaryService` | 并行分析、后台任务、事务化提交、Worker 调度 |
| 上下文管理 | `PromptContextCompressor` / `ConversationPrompt` / `MemoryService` | 固定 Prompt 顺序、窗口裁剪/折叠、running summary、记忆注入 |
| 状态与持久化 | `Message` / `Conversation` / `Memory` / `DailyLearningSummary` 模型 | 消息状态机、幂等唯一索引、折叠摘要、软删除、UTC 存储 |
| 成本控制 | `ConfiguredTextModelProvider` / `ConversationService` / `PromptContextCompressor` | 按用途选模型、关闭 reasoning、上下文预算、每日限额、批量去重 |
