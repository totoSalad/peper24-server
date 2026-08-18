# peper24 模块架构总览

## 模块关系图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           HTTP 请求入口                              │
│  AccountController  ConversationController  TranslationController   │
│  MemoryController        VocabularyController                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
        ┌───────────────┐          ┌───────────────────┐
        │   Account     │          │   Conversation    │
        │   用户/认证    │          │   对话/消息/翻译   │
        └───────────────┘          └────────┬──────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │       AI          │
                    │  统一 AI 抽象层   │
                    │  (核心调度中心)   │
                    └──────┬───────────┘
           ┌───────────────┼────────────────┐
           ▼               ▼                ▼
   ┌────────────┐  ┌────────────┐  ┌────────────────┐
   │  Grammar   │  │ Vocabulary │  │    Memory      │
   │  语法分析  │  │ 词汇/复习  │  │  记忆/画像     │
   └────────────┘  └────────────┘  └────────────────┘
```

## 模块列表

| 模块 | 路径 | 职责 |
|---|---|---|
| AI | `app/module/ai/` | 所有 AI 能力的抽象接口和类型定义，是系统的"大脑" |
| Conversation | `app/module/conversation/` | 对话管理：创建会话、流式消息、翻译 |
| Grammar | `app/module/grammar/` | 语法错误分析、归类、纠正触发 |
| Memory | `app/module/memory/` | 用户长期记忆：画像、偏好、短期记忆 |
| Vocabulary | `app/module/vocabulary/` | 生词本管理、AI 词汇增强、间隔复习 (SM-2) |

## 设计原则

1. **Ports & Adapters**: 每个模块通过抽象类 (`*Ports.ts`) 定义数据存取接口，具体实现（MySQL）放在 `infrastructure` 层，测试用内存实现
2. **依赖注入**: 全部通过 `@eggjs/tegg` 的 `@Inject()` 进行 DI
3. **AI 集中抽象**: `ProductAIService` 定义全部 AI 能力接口，各模块只依赖抽象，不感知具体模型（DeepSeek/百炼/开发 Mock）
4. **幂等性**: 通过 `clientRequestId` 去重，防止网络重试导致重复操作

## 详细文档

- [AI 模块](./ai.md)
- [Conversation 模块](./conversation.md)
- [Grammar 模块](./grammar.md)
- [Memory 模块](./memory.md)
- [Vocabulary 模块](./vocabulary.md)
