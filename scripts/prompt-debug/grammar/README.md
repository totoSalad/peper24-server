# Grammar Prompt Benchmark

对比合并优化前的 `baseline` 与当前生产 `optimized` Prompt。两组固定使用相同模型、
Structured Output Schema、`reasoning: none` 和业务断言，并按轮次交错执行。

```bash
# 默认运行两个模型、两个 Prompt、12 个合成场景，每组两轮
pnpm run debug:prompt:grammar

# 固定 DeepSeek Flash，正式运行每个 Prompt/场景十轮
pnpm run debug:prompt:grammar -- \
  --target deepseek-flash \
  --prompt baseline,optimized \
  --runs 10 \
  --output scripts/prompt-debug/grammar/results/grammar-benchmark.json

# 检查最终 Prompt，不调用模型
pnpm run debug:prompt:grammar -- --dry-run --print-prompt
```

传入 `--output result.json` 会生成包含逐次结果与汇总指标的 JSON。使用
`benchmark-llm-latency` skill 从该 JSON 生成同名 HTML 报告；报告模板由 skill 统一维护，
仓库不保存重复模板。运行产物统一放在本目录的 `results/` 下，并由 `.gitignore` 排除。
