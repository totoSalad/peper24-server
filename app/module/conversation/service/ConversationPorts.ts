import type { AIUsage, Correction } from '../../ai/service/ProductAIService';
import type { GrammarOccurrenceGroup } from '../../grammar/service/GrammarPorts';

export type ConversationStatus = 'active' | 'archived';
export type MessageRole = 'user' | 'assistant';
export type MessageStatus = 'streaming' | 'completed' | 'interrupted';

export interface ConversationRecord {
  id: string;
  userId: string;
  topic: string;
  scene?: string;
  status: ConversationStatus;
  /** 折叠消息的运行摘要（跨轮增量更新）。 */
  summary?: string;
  /** 运行摘要已覆盖的前缀消息条数（折叠边界）。 */
  summaryFoldedUntil?: number;
  /** 下一个可分配的会话内消息序号。 */
  nextMessageSequence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  replyToMessageId?: string;
  role: MessageRole;
  status: MessageStatus;
  content: string;
  translation?: string;
  correctionJson?: string;
  toolEventsJson?: string;
  clientRequestId?: string;
  /** 会话内严格递增的展示与上下文顺序。 */
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationListRecord extends ConversationRecord {
  lastMessage?: MessageRecord;
}

export type NewMessageRecord = Omit<MessageRecord, 'sequence'>;

export interface CreateConversationInput {
  conversation: ConversationRecord;
  welcomeMessage: MessageRecord;
}

export interface BeginExchangeInput {
  userId: string;
  userMessage: NewMessageRecord;
  assistantMessage: NewMessageRecord;
}

export type BeginExchangeResult =
  | { created: true; userMessage: MessageRecord; assistantMessage: MessageRecord }
  | { created: false; assistantMessage: MessageRecord };

export abstract class ConversationRepository {
  abstract create(input: CreateConversationInput): Promise<ConversationRecord>;
  abstract listByUser(userId: string): Promise<ConversationListRecord[]>;
  abstract findByIdForUser(id: string, userId: string): Promise<ConversationRecord | null>;
  abstract listMessages(id: string, userId: string): Promise<MessageRecord[] | null>;
  abstract findExchangeAssistant(
    conversationId: string,
    userId: string,
    clientRequestId: string,
  ): Promise<MessageRecord | null>;
  abstract getDailyChatTokens(userId: string, utcDate: string): Promise<number>;
  abstract findMessageForTranslation(userId: string, messageId: string): Promise<MessageRecord | null>;
  abstract saveTranslation(
    userId: string,
    messageId: string,
    translation: string,
    updatedAt: Date,
  ): Promise<MessageRecord | null>;
  abstract beginExchange(input: BeginExchangeInput): Promise<BeginExchangeResult>;
  abstract completeAssistant(
    userId: string,
    conversationId: string,
    messageId: string,
    content: string,
    usage: AIUsage,
    grammarGroups: GrammarOccurrenceGroup[],
    toolEvents: Array<Extract<import('../../ai/service/ProductAIService').ChatEvent, { type: 'tool.call' | 'tool.result' }>>,
    updatedAt: Date,
  ): Promise<Correction[]>;
  abstract interruptAssistant(
    userId: string,
    conversationId: string,
    messageId: string,
    content: string,
    updatedAt: Date,
  ): Promise<void>;
  abstract updateSummary(
    conversationId: string,
    userId: string,
    summary: string,
    foldedUntil: number,
  ): Promise<void>;
}
