/** 全部是合成数据，不包含真实用户内容。 */
export const vocabularyCases = [
  {
    id: 'chinese-food',
    description: '中文片段应转成英文短表达',
    input: {
      text: '白萝卜',
      context: 'I bought some 白萝卜 and cooked it with beef.',
    },
    expectation: {
      enMeaning: /^(?:daikon(?: radish)?|white radish)$/i,
    },
  },
  {
    id: 'english-idiom',
    description: '英文习语应保留表达本身并选择上下文义项',
    input: {
      text: 'rain check',
      context: 'I cannot go tonight. Can I take a rain check?',
    },
    expectation: {
      enMeaning: /^rain check$/i,
      cnMeaning: /改期|延期|改天|下次|另约|再约|以后|推迟/,
    },
  },
  {
    id: 'english-word',
    description: '普通英文单词应产生完整词汇信息',
    input: {
      text: 'procrastinate',
      context: 'I tend to procrastinate when it comes to homework.',
    },
    expectation: {
      enMeaning: /^procrastinate$/i,
    },
  },
  {
    id: 'person-name-chinese',
    description: '上下文中的中文人名必须返回空对象',
    input: {
      text: '梁静茹',
      context: 'She is "梁静茹", my favorite singer.',
    },
    expectation: { empty: true },
  },
  {
    id: 'ambiguous-common-name',
    description: '可作人名的普通词在非人名语境中仍按词汇处理',
    input: {
      text: 'rose',
      context: 'He gave me a red rose for my birthday.',
    },
    expectation: {
      enMeaning: /^rose$/i,
      cnMeaning: /玫瑰/,
    },
  },
];
