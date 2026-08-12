/**
 * 全部内容都是合成数据。评估只约束产品行为，不约束具体中文措辞。
 */
export const memoryCases = [
  {
    id: 'reject-trivial-daily-details',
    description: '一次性的饮食、购物和日程不应成为记忆',
    input: {
      targetMessageIds: [ 'u1' ],
      messages: [{
        id: 'u1', role: 'user',
        content: '今天午饭吃了番茄鸡蛋面，下午三点去便利店买了瓶水。',
      }],
      existingMemories: [],
    },
    expectation: { shouldSave: false },
  },
  {
    id: 'reject-turn-level-choice',
    description: '当前一轮的选择不等于稳定偏好',
    input: {
      targetMessageIds: [ 'u2' ],
      messages: [
        { id: 'a1', role: 'assistant', content: '这次练习想聊咖啡还是茶？' },
        { id: 'u2', role: 'user', content: '咖啡吧。' },
      ],
      existingMemories: [],
    },
    expectation: { shouldSave: false },
  },
  {
    id: 'keep-durable-themes',
    description: '稳定职业背景与长期爱好可以保留，但不拆成细碎事实',
    input: {
      targetMessageIds: [ 'u3' ],
      messages: [{
        id: 'u3', role: 'user',
        content: '我在上海做产品经理。徒步是我坚持很多年的爱好，基本每个周末都会去。',
      }],
      existingMemories: [],
    },
    expectation: { shouldSave: true, allowedTypes: [ 'profile', 'preference' ] },
  },
  {
    id: 'cohesive-long-term-goal',
    description: '目标、时间和动机应合并为一条完整记忆',
    input: {
      targetMessageIds: [ 'u4' ],
      messages: [{
        id: 'u4', role: 'user',
        content: '我想明年把雅思考到 7 分，然后申请英国的研究生，这是我学英语最主要的原因。',
      }],
      existingMemories: [],
    },
    expectation: {
      shouldSave: true,
      allowedTypes: [ 'significant_fact' ],
      summaryMustMatch: [ /雅思|IELTS/i, /英国|研究生|留学|graduate/i ],
    },
  },
  {
    id: 'suppress-existing-duplicate',
    description: '没有新增信息的已有记忆不重复输出',
    input: {
      targetMessageIds: [ 'u5' ],
      messages: [{ id: 'u5', role: 'user', content: '对，我还是住在上海。' }],
      existingMemories: [{
        type: 'profile', content: '住在上海', summary: 'Lives in Shanghai', normalizedKey: 'lives in shanghai',
      }],
    },
    expectation: { shouldSave: false },
  },
  {
    id: 'resolve-contextual-answer',
    description: '助手消息只用于理解目标用户的简短回答',
    input: {
      targetMessageIds: [ 'u6' ],
      messages: [
        { id: 'a2', role: 'assistant', content: '你现在长期住在哪个城市？' },
        { id: 'u6', role: 'user', content: '上海。' },
      ],
      existingMemories: [],
    },
    expectation: { shouldSave: true, allowedTypes: [ 'profile' ] },
  },
];
