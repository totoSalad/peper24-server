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

真实调用使用 `DASHSCOPE_API_KEY`，模型可通过 `BAILIAN_MODEL` 覆盖，默认是
`qwen3.7-flash`。脚本以非零状态退出表示至少一个场景未满足预期，方便反复调整 Prompt。

## 词汇增强模型对比

```bash
# 固定线上 Structured Output Prompt，对比 DeepSeek V4 Flash 与 Qwen Flash；每个场景默认运行两轮
pnpm run debug:prompt:vocabulary

# 每组重复 3 次，输出更稳定的 p50 / p95
pnpm run debug:prompt:vocabulary -- --runs 3

# 只运行指定模型目标或场景
pnpm run debug:prompt:vocabulary -- --target deepseek-flash --case chinese-food
pnpm run debug:prompt:vocabulary -- --target deepseek-flash,qwen-flash --case chinese-food

# 不调用模型，检查用例及 prompt
pnpm run debug:prompt:vocabulary -- --dry-run --print-prompt

# 供后续脚本分析
pnpm run debug:prompt:vocabulary -- --runs 3 --json
```

合成用例与正确性规则在 `vocabulary/cases.mjs`。脚本固定使用线上 Prompt、结构化输出
Schema 和重试函数，默认比较 DeepSeek 官方端点的 `deepseek-v4-flash` 与百炼端点的
`qwen-flash`，记录每次调用耗时、输入/输出 token、通过率，并按模型目标汇总平均值、
p50 和 p95。真实调用会读取仓库根目录 `.env` 中的 `DEEPSEEK_API_KEY` 和
`DASHSCOPE_API_KEY`。

两组都强制使用 `reasoning: none`。除厂商与模型外，Prompt、Schema、执行顺序和业务检查保持一致。
耗时覆盖模型调用、JSON 解析、对象组装和业务检查。

## 语法分析模型对比

```bash
# 2 个模型 × baseline/optimized 两个 Prompt；12 个场景，每组默认两轮
pnpm run debug:prompt:grammar

# 正式比较：每个模型 × Prompt × 场景运行 10 轮，并生成 JSON
pnpm run debug:prompt:grammar -- --runs 10 --output scripts/prompt-debug/grammar/results/peper24-grammar-prompt-benchmark.json

# 固定模型，只比较两个 Prompt
pnpm run debug:prompt:grammar -- --target deepseek-flash --prompt baseline,optimized --runs 10

# 只运行一个 Prompt 或场景
pnpm run debug:prompt:grammar -- --prompt optimized --case missing-article

# 不调用模型，检查用例及 Prompt
pnpm run debug:prompt:grammar -- --dry-run --print-prompt
```

合成用例与业务断言在 `grammar/cases.mjs`，覆盖正确句、六类单项/组合错误、中英文显式语法
提问、只含拼写错误的非目标输入，以及学习者文本中的提示注入。脚本复用线上
`GrammarAnalysisPrompt`、与生产定义相同的本地 Zod Schema 镜像和统一重试链路，对比 `deepseek-v4-flash`
与 `qwen-flash`。`baseline` 是当前线上 Prompt；`optimized` 只增加错误准入、易混分类边界、
学习者数据注入防护和三个反例，不修改 Schema 或调用链。结果按 `模型:Prompt` 分组，并将
模型调用、结构化解析、Schema 校验、对象组装和业务语义检查全部计入耗时。所有组合固定
使用 `reasoning: none`，按轮次交错执行以降低服务端负载变化造成的顺序偏差。

传入 `--output result.json` 时会生成包含逐次结果与汇总指标的 JSON。使用
`benchmark-llm-latency` skill 从该 JSON 生成同名 HTML 报告；HTML 模板由 skill 统一维护，
仓库不保存重复模板。

## 翻译模型对比

```bash
# DeepSeek V4 Flash 与 Qwen 3.7 Flash；5 个场景，每个场景默认两轮
pnpm run debug:prompt:translation

# 只运行指定模型目标或场景
pnpm run debug:prompt:translation -- --target deepseek-flash --case english-idiom

# 不调用模型，检查用例及 Prompt
pnpm run debug:prompt:translation -- --dry-run --print-prompt

# 输出可供分析脚本读取的逐次结果
pnpm run debug:prompt:translation -- --runs 10 --json
```

合成用例与业务正确性规则在 `translation/cases.mjs`，覆盖中英互译、中文口语、英文习语、
姓名与数字保真、列表内容完整性（允许换行被压平）。脚本固定使用线上翻译 Prompt、`TranslationOutputSchema` 和
重试函数，对比 DeepSeek 官方端点的 `deepseek-v4-flash` 与百炼端点的
`qwen3.7-flash`。两组都强制使用 `reasoning: none`，默认共执行 20 次调用。

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
