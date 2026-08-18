/** 全部是合成对话，不包含真实用户内容。 */
export const conversationCases = [
  {
    id: 'follow-open-thread',
    description: '应接住用户对第一次游泳课的担忧，而不是重新开启泛泛的游泳话题',
    topic: 'Trying a new hobby',
    scene: 'Two friends chat before the learner tries a new activity.',
    learner: { englishLevel: 'B1', memories: [] },
    messages: [
      { role: 'user', content: 'I signed up for my first swimming lesson tomorrow.' },
      { role: 'assistant', content: 'That sounds exciting! What part are you most curious about?' },
      { role: 'user', content: "Honestly, I'm nervous because I still can't float." },
    ],
  },
  {
    id: 'latest-fact-wins',
    description: '用户更正居住城市后，应以 Boston 为准，不得继续沿用 Seattle',
    topic: 'Exploring the city',
    scene: 'Friends swap ideas for a free Saturday.',
    learner: { englishLevel: 'B1', memories: [] },
    messages: [
      { role: 'user', content: 'I have lived in Seattle for three years.' },
      { role: 'assistant', content: 'Seattle must have given you plenty of cozy coffee spots to explore.' },
      { role: 'user', content: 'Actually, I moved to Boston last month. Seattle is my old home now.' },
      { role: 'assistant', content: 'Oh, Boston is the new chapter then! Have you found a favorite neighborhood yet?' },
      { role: 'user', content: 'Not yet. I want to explore somewhere this Saturday.' },
    ],
  },
  {
    id: 'updated-preference-wins',
    description: '用户最新的音乐偏好覆盖早先偏好，不能仍推荐吵闹的摇滚现场',
    referenceFacts: [
      'Iron & Wine and Bon Iver are acceptable examples of mellow acoustic or indie-folk listening in this case; recommending them is not a loud-rock contradiction.',
      'A stripped-down acoustic cover of a rock ballad is acceptable when the reply explicitly frames it as soft or soothing.',
    ],
    topic: 'Music after work',
    scene: 'Friends talk about what they listen to after a busy day.',
    learner: { englishLevel: 'B2', memories: [] },
    messages: [
      { role: 'user', content: 'I used to love loud rock concerts.' },
      { role: 'assistant', content: 'Same here—the energy can be incredible. Do you have a favorite band?' },
      { role: 'user', content: 'Not anymore. Loud shows trigger my migraines, so now I only listen to soft acoustic music.' },
      { role: 'assistant', content: 'That makes sense; a gentle acoustic sound is much kinder when noise is a trigger.' },
      { role: 'user', content: 'Exactly. What could I listen to tonight?' },
    ],
  },
  {
    id: 'respect-stated-boundary',
    description: '用户明确要求不再聊狗后，后续建议不得再次提 Coco 或狗',
    topic: 'A relaxing weekend',
    scene: 'Friends make low-key weekend plans.',
    learner: { englishLevel: 'A2', memories: [] },
    messages: [
      { role: 'assistant', content: 'I might take Coco to the park. Would you like to spend time with a dog too?' },
      { role: 'user', content: "I'm scared of dogs. Please don't bring up Coco or dogs with me again." },
      { role: 'assistant', content: "Of course—I won't bring that up again. We can think of something that feels comfortable for you." },
      { role: 'user', content: 'Thanks. I just want a quiet weekend. Any ideas?' },
    ],
  },
];
