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
  --output /tmp/grammar-benchmark.json

# 检查最终 Prompt，不调用模型
pnpm run debug:prompt:grammar -- --dry-run --print-prompt
```

传入 `--output result.json` 会同时生成 `result.html`。JSON 与 HTML 包含正确数量和比例、
调用成功率、平均耗时、p50/p95、Token、逐 case 指标、错误 case 原始输出和原因分类，
以及相对同组总体达到 1.5 倍阈值的异常慢 case。

已有 JSON 可以重新生成 HTML：

```bash
pnpm run debug:prompt:grammar:report -- /tmp/grammar-benchmark.json
```
