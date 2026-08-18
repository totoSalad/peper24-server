/** 全部是合成数据，不包含真实用户内容。 */
export const translationCases = [
  {
    id: 'english-simple',
    description: '英文日常句应自然翻译为中文',
    input: {
      content: 'I almost missed the train this morning.',
      targetLanguage: 'Chinese',
    },
    expectation: {
      mustMatch: [ /差点|险些/, /火车/ ],
    },
  },
  {
    id: 'chinese-colloquial',
    description: '中文口语应自然翻译为英文',
    input: {
      content: '这个周末我想出去散散心。',
      targetLanguage: 'English',
    },
    expectation: {
      mustMatch: [ /weekend/i, /clear my (?:head|mind)|unwind|relax|get some fresh air|take a break/i ],
    },
  },
  {
    id: 'english-idiom',
    description: '习语应按上下文翻译而不是逐字直译',
    input: {
      content: "I can't join you tonight, but I'll take a rain check.",
      targetLanguage: 'Chinese',
    },
    expectation: {
      mustMatch: [ /今晚/, /改天|下次|另约|再约|以后|延期|推迟/ ],
      mustNotMatch: [ /雨.*支票|支票.*雨/ ],
    },
  },
  {
    id: 'names-and-numbers',
    description: '翻译时应保留姓名、金额和数量',
    input: {
      content: 'Alice paid $24.50 for 3 notebooks.',
      targetLanguage: 'Chinese',
    },
    expectation: {
      mustMatch: [ /Alice|爱丽丝/i, /\$24\.50|24\.50\s*美元/, /3/, /笔记本/ ],
    },
  },
  {
    id: 'multiline-formatting',
    description: '多行列表压平也可接受，但内容必须完整',
    input: {
      content: '购物清单：\n- 牛奶\n- 全麦面包',
      targetLanguage: 'English',
    },
    expectation: {
      mustMatch: [ /shopping list/i, /milk/i, /whole[- ]wheat bread/i ],
    },
  },
];
