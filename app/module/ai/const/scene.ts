export interface ConversationScene {
  topic: string;
  scene: string;
  /** 下发到 app 用于前端展示的话题图标（emoji）。 */
  icon: string;
}

/** 陪练话题 + 场景池：新建会话时，话题只能从这里选择。 */
export const SCENES: ConversationScene[] = [
  { topic: 'airport', scene: "you're at the airport about to take your first solo trip abroad, and you're a little nervous about how everything works.", icon: '✈️' },
  { topic: 'restaurant', scene: "you're at a new restaurant with a friend and you want to figure out what to order and how to ask for recommendations.", icon: '🍽️' },
  { topic: 'moving', scene: "you just moved into a new apartment and a neighbor stops by to say hi, and you'd like to make a good first impression.", icon: '📦' },
  { topic: 'job interview', scene: 'you have a job interview tomorrow and you want to practice introducing yourself and answering common questions.', icon: '💼' },
  { topic: 'health', scene: "you're at the doctor's office and you want to explain how you've been feeling and ask about a treatment.", icon: '🩺' },
  { topic: 'grocery', scene: "you're at the grocery store shopping for a dinner you'll cook tonight, and you want to talk about what to make.", icon: '🛒' },
  { topic: 'directions', scene: "you're lost in an unfamiliar part of the city and you need to ask someone for directions.", icon: '🗺️' },
  { topic: 'first meetup', scene: "you're at a coffee shop about to meet someone new for the first time, and you want to make the conversation flow.", icon: '☕' },
  { topic: 'weekend trip', scene: 'you and a friend are planning a weekend trip together and want to decide where to go and what to do.', icon: '🚗' },
  { topic: 'shopping', scene: "you're at a clothing store deciding whether to buy a jacket, and you want some opinions.", icon: '🛍️' },
  { topic: 'hotel', scene: "you're checking into a hotel after a long flight and want to confirm your booking and ask about the facilities.", icon: '🏨' },
  { topic: 'small talk', scene: "you're on a bus to work when a stranger starts a conversation, and you want to keep it going naturally.", icon: '💬' },
  { topic: 'gym', scene: "you want to sign up for a gym, you'd like to know how to choose a gym and what the registration process involves.", icon: '🏋️' },
  { topic: 'cooking', scene: 'you and a friend are cooking dinner together at your place, and you want to talk through the recipe.', icon: '🍳' },
  { topic: 'movie', scene: "you just watched a movie and can't stop thinking about it, and you want to talk about what it meant.", icon: '🎬' },
  { topic: 'birthday party', scene: "you're helping plan a birthday party for a close friend and want ideas for food and games.", icon: '🎂' },
  { topic: 'party', scene: "you're at a party and don't know most of the people, and you want to get to know someone new.", icon: '🥳' },
  { topic: 'bank', scene: "you're at the bank trying to open a new account, and you want to understand the options.", icon: '🏦' },
  { topic: 'tech support', scene: "your internet keeps dropping and you're on the phone with support, trying to explain the problem and fix it.", icon: '💻' },
  { topic: 'music', scene: 'a friend sends you a song and asks what you think, and you want to share your taste and hear theirs.', icon: '🎵' },
  { topic: 'book', scene: 'you just finished a book and want to talk about the story and why you liked it.', icon: '📖' },
  { topic: 'hiking', scene: 'you and a friend are hiking and stop to enjoy the view, and you want to talk about the trip and nature.', icon: '🥾' },
  { topic: 'puppy', scene: "you just adopted a puppy and you're telling your friend about your new life with it.", icon: '🐶' },
  { topic: 'art', scene: "you're at a museum standing in front of a painting you really like, and you want to say why it speaks to you.", icon: '🎨' },
  { topic: 'takeout', scene: "you're ordering takeout for a quiet night in, and you want to decide what to eat.", icon: '🥡' },
  { topic: 'work', scene: 'you had a rough day at work and a friend asks how it went, and you want to talk it through.', icon: '💼' },
  { topic: 'relocation', scene: "you're thinking about moving to a new city and can't decide, and you want to weigh the pros and cons.", icon: '🏠' },
  { topic: 'painting', scene: "you just started learning to paint and you're showing your friend your first attempts, and you want feedback and encouragement.", icon: '🖌️' },
  { topic: 'supermarket', scene: "you're at the supermarket comparing two brands of the same thing, and you want to decide which to buy.", icon: '🛒' },
  { topic: 'holidays', scene: "you're celebrating the holidays with people who do things a little differently, and you're curious about their traditions.", icon: '🎄' },
];

/** 按话题从场景池查找对应场景；话题不在池中则返回 undefined。 */
export function findScene(topic: string): ConversationScene | undefined {
  return SCENES.find(item => item.topic === topic);
}
