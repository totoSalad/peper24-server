# Prompt 调试脚本

这里放与线上 Egg 容器解耦的 Prompt 实验。每个子目录对应一个长期 Prompt，包含：

- 合成场景（禁止放真实用户数据）；
- 直接调用模型的 runner；
- 可重复执行的结果检查；
- 该 Prompt 特有的调试说明。

## 记忆提取

```bash
# 跑全部记忆场景（自动读取仓库根目录 .env）
pnpm run debug:prompt:memory

# 只跑一个场景
pnpm run debug:prompt:memory -- --case cohesive-long-term-goal

# 不调用模型，只检查用例和最终 prompt
pnpm run debug:prompt:memory -- --dry-run --print-prompt

# 使用已经固定下来的真实会话消息，与原有 5 条数据库记忆比较
pnpm run debug:prompt:memory:real
```

真实调用使用 `DEEPSEEK_API_KEY`，模型可通过 `DEEPSEEK_MODEL` 覆盖，默认是
`deepseek-chat`。脚本以非零状态退出表示至少一个场景未满足预期，方便反复调整 Prompt。

## 词汇增强 Prompt 延迟对比

```bash
# 默认只对比 baseline 与 json-mode；每个场景、每个版本运行一次
pnpm run debug:prompt:vocabulary

# 每组重复 3 次，输出更稳定的 p50 / p95
pnpm run debug:prompt:vocabulary -- --runs 3

# 固定 baseline Schema，只对比 DeepSeek 推理强度
pnpm run debug:prompt:vocabulary -- --variant baseline --reasoning provider-default,low,none --runs 10

# 只跑指定版本或场景
pnpm run debug:prompt:vocabulary -- --variant json-mode --case chinese-food

# 不调用模型，检查用例及 prompt
pnpm run debug:prompt:vocabulary -- --dry-run --print-prompt

# 供后续脚本分析
pnpm run debug:prompt:vocabulary -- --runs 3 --json
```

候选 Prompt 在 `vocabulary/prompts.mjs`，合成用例与正确性规则在
`vocabulary/cases.mjs`。脚本使用与线上相同的结构化输出 Schema 和重试函数，记录每次
调用耗时、输入/输出 token、通过率，并按版本汇总平均值、p50 和 p95。真实调用会读取
仓库根目录 `.env` 中的 `DEEPSEEK_API_KEY`。

脚本只保留两种输出链路：`baseline` 复用当前线上 Prompt 和 Schema Structured Output；
`json-mode` 使用 DeepSeek 原生 `json_object` 响应格式，但不向模型传入 JSON Schema，
Prompt 只包含紧凑字段示例，返回后通过 `VocabularyEnrichmentSchema` 做应用层校验。两组
耗时都覆盖模型调用、JSON 解析、对象组装和检查。

真实会话 fixture 固定为：

```text
scripts/prompt-debug/memory/fixtures/
└── 01KZNJ2ZYNKW60G3H6FCFJ2ZVP.local.json
```

文件内写死了这条会话的 35 条完整消息、17 个目标用户消息 ID、当时用户的其他记忆，
以及这条会话原来关联的 5 条数据库记忆。它只用于本地回归调试，权限为 `0600`，并通过
`*.local.json` 排除在 Git 之外。

`debug:prompt:memory:real` 中的 `--allow-real-data` 表示允许把该 fixture 的完整真实消息
发送给配置的外部模型。
