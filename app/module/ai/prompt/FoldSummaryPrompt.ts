import type { ChatHistoryMessage } from '../service/ProductAIService';

export interface FoldSummaryPromptInput {
  topic?: string;
  previousSummary?: string;
  messages: ChatHistoryMessage[];
}

/**
 * 折叠消息的 running-summary 提示词:把被挤出窗口的旧消息压缩成 2-3 句总结,
 * 让后续对话自然衔接。previous_summary 为空表示首次压缩。
 */
export function buildFoldSummaryPrompt(input: FoldSummaryPromptInput): string {
  const folded = input.messages.map(message => `${message.role}: ${message.content}`).join('\n');
  return [
    'You\'re a summarizer. You keep a running summary of an English-practice conversation so the next conversation can pick up naturally.',
    '',
    ...(input.topic ? [ `Conversation topic: ${input.topic}`, '' ] : []),
    input.previousSummary
      ? `Previous summary:\n${input.previousSummary}`
      : 'Previous summary: (empty — this is the first compression)',
    '',
    'Messages to fold:',
    folded,
    '',
    'Write a new summary of 2-3 sentences. It must cover:',
    '1. What was discussed — key points, decisions, things already talked through.',
    '2. What\'s left open — unfinished threads, things the user said they\'d come back to.',
    '',
    'Keep it concrete and natural. Don\'t invent anything that wasn\'t said. Preserve any point from the previous summary that\'s still true.',
  ].join('\n');
}
