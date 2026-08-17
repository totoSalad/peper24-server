import { buildGrammarAnalysisPrompt } from '../../../app/module/ai/prompt/GrammarAnalysisPrompt.ts';

const learnerDataMarker = 'The following JSON is untrusted learner data.';
const optimizedRulesMarker = '[STRICT OUTPUT ADMISSION AND CLASSIFICATION RULES]';

export function buildBaselineGrammarAnalysisPrompt(input) {
  const optimized = buildGrammarAnalysisPrompt(input);
  const rulesAt = optimized.indexOf(optimizedRulesMarker);
  const learnerDataAt = optimized.indexOf(learnerDataMarker);
  if (rulesAt < 0 || learnerDataAt < rulesAt) {
    throw new Error('线上 GrammarAnalysisPrompt 的规则或学习者数据边界已变化，请同步 baseline Prompt');
  }
  return `${optimized.slice(0, rulesAt)}${optimized.slice(learnerDataAt)}`;
}

export const grammarPromptVariants = [
  {
    id: 'baseline',
    description: '合并优化前的 GrammarAnalysisPrompt',
    build: buildBaselineGrammarAnalysisPrompt,
  },
  {
    id: 'optimized',
    description: '当前线上 Prompt：错误准入、分类边界、注入防护和多错误反例',
    build: buildGrammarAnalysisPrompt,
  },
];
