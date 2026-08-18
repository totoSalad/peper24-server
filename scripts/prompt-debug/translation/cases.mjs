export const translationCases = [
  {
    id: 'short-en-zh',
    description: '高频英译中短句',
    input: { content: 'I would like a cup of coffee.', targetLanguage: 'Chinese' },
    expectation: { includes: [ /咖啡/u ], excludes: [] },
  },
  {
    id: 'short-zh-en',
    description: '高频中译英短句',
    input: { content: '我们下午三点开会。', targetLanguage: 'English' },
    expectation: { includes: [ /(?:3|three)/iu, /meet/iu ], excludes: [] },
  },
  {
    id: 'names-and-numbers',
    description: '保留人名、年份和地名',
    input: {
      content: 'Alice moved to Shanghai in 2026.',
      targetLanguage: 'Chinese',
    },
    expectation: { includes: [ /(?:Alice|[爱艾]丽丝)/iu, /2026/u, /上海/u ], excludes: [] },
  },
  {
    id: 'list-formatting',
    description: '保留多行列表格式',
    input: {
      content: 'Shopping list:\n- apples\n- milk',
      targetLanguage: 'Chinese',
    },
    expectation: {
      includes: [ /苹果/u, /牛奶/u ],
      excludes: [],
      validate: output => output.split('\n').filter(line => /^\s*-\s+/u.test(line)).length >= 2
        ? []
        : [ '未保留两行列表格式' ],
    },
  },
  {
    id: 'weather-idiom',
    description: '习语需要意译，不能字面翻译',
    input: {
      content: "It's raining cats and dogs outside.",
      targetLanguage: 'Chinese',
    },
    expectation: { includes: [ /雨/u ], excludes: [ /猫/u, /狗/u ] },
  },
  {
    id: 'encouragement-idiom',
    description: '对话语气与习语语义',
    input: {
      content: '“Break a leg!” she said before the show.',
      targetLanguage: 'Chinese',
    },
    expectation: {
      includes: [ /(?:好运|顺利|成功|加油)/u ],
      excludes: [ /(?:断|摔).{0,2}腿/u ],
    },
  },
];

export function evaluateTranslationCase(testCase, output) {
  const errors = [];
  if (!output.trim()) errors.push('输出为空');
  for (const expected of testCase.expectation.includes) {
    if (!expected.test(output)) errors.push(`缺少必要语义: ${expected}`);
  }
  for (const forbidden of testCase.expectation.excludes) {
    if (forbidden.test(output)) errors.push(`出现错误字面语义: ${forbidden}`);
  }
  if (testCase.expectation.validate) errors.push(...testCase.expectation.validate(output));
  return errors;
}
