import { z } from 'zod';

import { grammarErrorTypes } from '../../../app/module/ai/service/ProductAIService.ts';

// GrammarAnalysisSchema 的独立 runner 镜像。生产 Schema 通过无扩展名的
// TypeScript import 引用枚举，Node 的类型擦除模式无法直接解析完整模块图；
// 这里仍直接复用生产枚举，只镜像对象字段约束。

export const GrammarAnalysisBenchmarkSchema = z.object({
  explicitGrammarQuestion: z.boolean(),
  errors: z.array(z.object({
    errorType: z.enum(grammarErrorTypes),
    original: z.string().min(1).max(300),
    corrected: z.string().min(1).max(300),
    note: z.string().min(1).max(200),
  })).max(8),
});
