import { AccessLevel, Inject, Logger, SingletonProto } from '@eggjs/tegg';
import { findScene } from '../../ai/const/scene';
import {
  AIUsage,
  ChatEvent,
  Correction,
  GrammarAnalysis,
  LearnerContext,
  ProductAIService,
} from '../../ai/service/ProductAIService';
import { GrammarService } from '../../grammar/service/GrammarService';
import { AppError } from '../../system/error/AppError';
import { Clock, IdGenerator } from '../../system/service/SystemPorts';
import { VocabularyService } from '../../vocabulary/service/VocabularyService';
import { MemoryService } from '../../memory/service/MemoryService';
import {
  ConversationRecord,
  ConversationRepository,
  MessageRecord,
  NewMessageRecord,
} from './ConversationPorts';

export interface CreateConversationRequest {
  topic: string;
}

export interface StreamMessageRequest {
  content: string;
  clientRequestId: string;
  signal?: AbortSignal;
}

const replayUsage: AIUsage = {
  provider: 'peper24',
  model: 'stored-response',
  inputTokens: 0,
  outputTokens: 0,
};

const emptyGrammarAnalysis: GrammarAnalysis = {
  explicitGrammarQuestion: false,
  errors: [],
};

const HAN_FRAGMENT = /\p{Script=Han}+/gu;
const LATIN_WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
const QUOTE = '["“”\'‘’]';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isChineseNameOrLabel(content: string, expression: string): boolean {
  const quoted = `${QUOTE}\\s*${escapeRegExp(expression)}\\s*${QUOTE}`;
  return new RegExp(`\\bcalled\\s+${quoted}\\s+in\\s+chinese\\b`, 'i').test(content)
    || new RegExp(`\\b(?:she|he)\\s+is\\s+${quoted}`, 'i').test(content)
    || new RegExp(`\\b(?:her|his)\\s+name\\s+is\\s+${quoted}`, 'i').test(content);
}

export function extractEmbeddedChineseExpressions(
  content: string,
  onSkippedNameOrLabel?: (expression: string) => void,
): string[] {
  if ((content.match(LATIN_WORD) ?? []).length < 2) return [];
  const expressions: string[] = [];
  for (const match of content.matchAll(HAN_FRAGMENT)) {
    const expression = match[0].trim();
    if (!expression || expression.length > 40 || expressions.includes(expression)) continue;
    if (isChineseNameOrLabel(content, expression)) {
      onSkippedNameOrLabel?.(expression);
      continue;
    }
    expressions.push(expression);
    if (expressions.length === 3) break;
  }
  return expressions;
}

export const DEFAULT_DAILY_CHAT_TOKEN_LIMIT = 150_000;

function dailyChatTokenLimit(): number {
  const configured = process.env.DAILY_CHAT_TOKEN_LIMIT;
  if (configured === undefined) return DEFAULT_DAILY_CHAT_TOKEN_LIMIT;
  const limit = Number(configured);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('DAILY_CHAT_TOKEN_LIMIT must be a positive integer');
  }
  return limit;
}

function utcDay(now: Date): { date: string; resetsAt: Date } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const resetsAt = new Date(from);
  resetsAt.setUTCDate(resetsAt.getUTCDate() + 1);
  return { date: from.toISOString().slice(0, 10), resetsAt };
}

@SingletonProto({ accessLevel: AccessLevel.PUBLIC })
export class ConversationService {
  constructor(
    @Inject('ConversationRepository') private readonly conversations: ConversationRepository,
    @Inject('ProductAIService') private readonly ai: ProductAIService,
    @Inject('IdGenerator') private readonly ids: IdGenerator,
    @Inject('Clock') private readonly clock: Clock,
    @Inject() private readonly grammar: GrammarService,
    @Inject() private readonly vocabulary: VocabularyService,
    @Inject() private readonly memory: MemoryService,
    @Inject('aiLogger') private readonly aiLogger: Logger,
  ) {}

  async createConversation(
    userId: string,
    input: CreateConversationRequest,
    learner?: LearnerContext,
  ) {
    // 话题只能从陪练场景池中选择，场景随之取自池中定义。
    const topic = input.topic.trim();
    const found = findScene(topic);
    if (!found) {
      throw new AppError('INVALID_TOPIC', '话题必须从陪练场景列表中选择');
    }
    const scene = found.scene;
    const now = this.clock.now();
    const conversation: ConversationRecord = {
      id: this.ids.next(),
      userId,
      topic,
      scene,
      status: 'active',
      summaryFoldedUntil: 0,
      nextMessageSequence: 2,
      createdAt: now,
      updatedAt: now,
    };
    const learnerWithMemories = await this.withMemories(userId, learner);
    const welcomeContent = await this.ai.createWelcome({
      userId, topic, scene, learner: learnerWithMemories,
    });
    const welcomeMessage: MessageRecord = {
      id: this.ids.next(),
      conversationId: conversation.id,
      role: 'assistant',
      status: 'completed',
      content: welcomeContent,
      sequence: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.conversations.create({ conversation, welcomeMessage });
    return { conversation: this.toConversation(conversation), welcomeMessage: this.toMessage(welcomeMessage) };
  }

  async listConversations(userId: string) {
    return (await this.conversations.listByUser(userId)).map(item => ({
      ...this.toConversation(item),
      lastMessage: item.lastMessage ? this.toMessage(item.lastMessage) : undefined,
    }));
  }

  async listMessages(userId: string, conversationId: string) {
    const messages = await this.conversations.listMessages(conversationId, userId);
    if (!messages) throw new AppError('CONVERSATION_NOT_FOUND', '会话不存在', 404);
    return messages.map(item => this.toMessage(item));
  }

  async* streamMessage(
    userId: string,
    conversationId: string,
    input: StreamMessageRequest,
    learner?: LearnerContext,
  ): AsyncIterable<ChatEvent> {
    const content = input.content.trim();
    if (!content || content.length > 4000) {
      throw new AppError('INVALID_MESSAGE', '消息长度必须是 1 到 4000 个字符');
    }
    if (!input.clientRequestId.trim() || input.clientRequestId.length > 128) {
      throw new AppError('INVALID_CLIENT_REQUEST_ID', '客户端请求 ID 不正确');
    }
    const conversation = await this.conversations.findByIdForUser(conversationId, userId);
    if (!conversation) throw new AppError('CONVERSATION_NOT_FOUND', '会话不存在', 404);
    const now = this.clock.now();
    const clientRequestId = input.clientRequestId.trim();
    const existingAssistant = await this.conversations.findExchangeAssistant(
      conversationId,
      userId,
      clientRequestId,
    );
    if (existingAssistant && existingAssistant.status !== 'interrupted') {
      yield* this.replay(existingAssistant);
      return;
    }
    await this.enforceDailyTokenLimit(userId, now);
    const history = await this.conversations.listMessages(conversationId, userId) ?? [];
    const userMessage: NewMessageRecord = {
      id: this.ids.next(),
      conversationId,
      role: 'user',
      status: 'completed',
      content,
      clientRequestId,
      createdAt: now,
      updatedAt: now,
    };
    const assistantMessage: NewMessageRecord = {
      id: this.ids.next(),
      conversationId,
      replyToMessageId: userMessage.id,
      role: 'assistant',
      status: 'streaming',
      content: '',
      createdAt: now,
      updatedAt: now,
    };
    const exchange = await this.conversations.beginExchange({
      userId,
      userMessage,
      assistantMessage,
    });
    if (!exchange.created) {
      yield* this.replay(exchange.assistantMessage);
      return;
    }

    let generatedContent = '';
    let doneUsage: AIUsage | undefined;
    const toolEvents: Array<Extract<ChatEvent, { type: 'tool.call' | 'tool.result' }>> = [];
    const learnerWithMemories = await this.withMemories(userId, learner);
    const grammarAnalysis = this.ai.analyzeGrammar({
      content,
      learner: learnerWithMemories,
      signal: input.signal,
    }).catch(() => emptyGrammarAnalysis);
    try {
      for await (const event of this.ai.chat({
        messageId: exchange.assistantMessage.id,
        userId,
        conversationId,
        topic: conversation.topic,
        scene: conversation.scene,
        history: history.map(message => ({ role: message.role, content: message.content })),
        content,
        requiredExpressions: extractEmbeddedChineseExpressions(content, expression => {
          this.aiLogger.info(
            '[vocabulary-detect] skipped person name or Chinese label text=%j',
            expression,
          );
        }),
        learner: learnerWithMemories,
        summary: conversation.summary,
        summaryFoldedUntil: conversation.summaryFoldedUntil,
        signal: input.signal,
        tools: {
          explainExpression: async value => {
            const resolved = await this.vocabulary.enrichExpression(
              value.text, value.context, learnerWithMemories,
            );
            if (!resolved) return null;
            const { expression, info } = resolved;
            const saved = await this.vocabulary.addFromTool(
              userId,
              expression,
              info,
              exchange.userMessage.id,
              content,
            );
            return { vocabularyId: saved.id, expression: saved.expression, ...info };
          },
        },
      })) {
        if ('messageId' in event && event.messageId !== exchange.assistantMessage.id) {
          throw new Error('AI event message ID mismatch');
        }
        if (event.type === 'message.delta') generatedContent += event.delta;
        if (event.type === 'tool.call' || event.type === 'tool.result') toolEvents.push(event);
        if (event.type === 'message.done') {
          doneUsage = event.usage;
          continue;
        }
        if (event.type === 'summary.update') {
          await this.conversations.updateSummary(
            conversationId,
            userId,
            event.summary,
            event.foldedUntil,
          );
          continue;
        }
        if (event.type === 'error') throw new Error(event.code);
        yield event;
      }
      if (!doneUsage) throw new Error('AI stream ended without usage');
      const grammarGroups = this.grammar.prepare(await grammarAnalysis);
      const corrections = await this.conversations.completeAssistant(
        userId,
        conversationId,
        exchange.assistantMessage.id,
        generatedContent,
        doneUsage,
        grammarGroups,
        toolEvents,
        this.clock.now(),
      );
      for (const correction of corrections) {
        yield {
          type: 'correction.ready',
          messageId: exchange.assistantMessage.id,
          correction,
        };
      }
      yield {
        type: 'message.done',
        messageId: exchange.assistantMessage.id,
        usage: doneUsage,
      };
    } catch {
      await this.conversations.interruptAssistant(
        userId,
        conversationId,
        exchange.assistantMessage.id,
        generatedContent,
        this.clock.now(),
      );
      yield { type: 'error', code: 'AI_STREAM_FAILED', retryable: true };
    }
  }

  private async* replay(message: MessageRecord): AsyncIterable<ChatEvent> {
    if (message.status !== 'completed') {
      yield { type: 'error', code: 'REQUEST_IN_PROGRESS', retryable: true };
      return;
    }
    yield { type: 'message.start', messageId: message.id };
    if (message.content) {
      yield { type: 'message.delta', messageId: message.id, delta: message.content };
    }
    for (const correction of this.parseCorrections(message.correctionJson)) {
      yield { type: 'correction.ready', messageId: message.id, correction };
    }
    for (const event of this.parseToolEvents(message.toolEventsJson)) yield event;
    yield { type: 'message.done', messageId: message.id, usage: replayUsage };
  }

  private parseCorrections(value?: string): Correction[] {
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [ parsed ];
  }

  private parseToolEvents(value?: string): Array<Extract<ChatEvent, { type: 'tool.call' | 'tool.result' }>> {
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  }

  private toConversation(conversation: ConversationRecord) {
    return {
      id: conversation.id,
      topic: conversation.topic,
      scene: conversation.scene,
      status: conversation.status,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private toMessage(message: MessageRecord) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      replyToMessageId: message.replyToMessageId,
      role: message.role,
      status: message.status,
      content: message.content,
      translation: message.translation,
      corrections: this.parseCorrections(message.correctionJson),
      clientRequestId: message.clientRequestId,
      sequence: message.sequence,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
    };
  }

  private async withMemories(userId: string, learner?: LearnerContext): Promise<LearnerContext> {
    return {
      ...(learner ?? { englishLevel: 'B1' as const }),
      memories: await this.memory.context(userId),
    };
  }

  private async enforceDailyTokenLimit(userId: string, now: Date): Promise<void> {
    const limit = dailyChatTokenLimit();
    const { date, resetsAt } = utcDay(now);
    const used = await this.conversations.getDailyChatTokens(userId, date);
    if (used < limit) return;
    throw new AppError(
      'DAILY_CHAT_TOKEN_LIMIT_EXCEEDED',
      '今日聊天 Token 额度已用完，请明天再试',
      429,
      { limit, used, resetsAt: resetsAt.toISOString() },
    );
  }
}
