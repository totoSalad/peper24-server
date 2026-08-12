import type {
  BeginExchangeInput,
  BeginExchangeResult,
  ConversationListRecord,
  ConversationRecord,
  ConversationRepository,
  CreateConversationInput,
  MessageRecord,
} from '../../../app/module/conversation/service/ConversationPorts';
import type {
  AIUsage,
  ChatEvent,
  ChatInput,
  DailyLearningSummaryGeneration,
  DailyLearningSummaryInput,
  Correction,
  GrammarAnalysis,
  GrammarAnalysisInput,
  MemoryExtractionInput,
  MemoryExtractionResult,
  GrammarErrorType,
  ProductAIService,
  TranslationInput,
  TranslationResult,
  VocabularyEnrichment,
  WelcomeInput,
} from '../../../app/module/ai/service/ProductAIService';
import type { GrammarOccurrenceGroup } from '../../../app/module/grammar/service/GrammarPorts';
import { DevelopmentProductAIService } from '../../../app/module/ai/provider/DevelopmentProductAIService';

export class InMemoryConversationRepository implements ConversationRepository {
  readonly conversations: ConversationRecord[] = [];
  readonly messages: MessageRecord[] = [];
  readonly usageByMessage = new Map<string, AIUsage>();
  readonly dailyChatTokens = new Map<string, number>();
  readonly grammarPatterns = new Map<GrammarErrorType, { count: number; corrected: boolean }>();
  readonly grammarOccurrences = new Map<string, GrammarOccurrenceGroup>();

  async create(input: CreateConversationInput): Promise<ConversationRecord> {
    this.conversations.push(input.conversation);
    this.messages.push(input.welcomeMessage);
    return input.conversation;
  }

  async listByUser(userId: string): Promise<ConversationListRecord[]> {
    return this.conversations.filter(item => item.userId === userId).map(conversation => ({
      ...conversation,
      lastMessage: this.messages
        .filter(message => message.conversationId === conversation.id)
        .sort((left, right) => right.sequence - left.sequence)[0],
    }));
  }

  async findByIdForUser(id: string, userId: string): Promise<ConversationRecord | null> {
    return this.conversations.find(item => item.id === id && item.userId === userId) ?? null;
  }

  async listMessages(id: string, userId: string): Promise<MessageRecord[] | null> {
    if (!(await this.findByIdForUser(id, userId))) return null;
    return this.messages.filter(item => item.conversationId === id);
  }

  async findExchangeAssistant(
    conversationId: string,
    userId: string,
    clientRequestId: string,
  ): Promise<MessageRecord | null> {
    if (!(await this.findByIdForUser(conversationId, userId))) return null;
    const userMessage = this.messages.find(
      item => item.conversationId === conversationId
        && item.role === 'user'
        && item.clientRequestId === clientRequestId,
    );
    if (!userMessage) return null;
    return this.messages.find(
      item => item.conversationId === conversationId
        && item.role === 'assistant'
        && item.replyToMessageId === userMessage.id,
    ) ?? null;
  }

  async getDailyChatTokens(userId: string, utcDate: string): Promise<number> {
    return this.dailyChatTokens.get(`${userId}:${utcDate}`) ?? 0;
  }

  async findMessageForTranslation(userId: string, messageId: string): Promise<MessageRecord | null> {
    const message = this.messages.find(item => item.id === messageId);
    if (!message || message.status !== 'completed') return null;
    const conversation = this.conversations.find(
      item => item.id === message.conversationId && item.userId === userId,
    );
    return conversation && message.content ? { ...message } : null;
  }

  async saveTranslation(
    userId: string, messageId: string, translation: string, updatedAt: Date,
  ): Promise<MessageRecord | null> {
    const message = await this.findMessageForTranslation(userId, messageId);
    if (!message) return null;
    const index = this.messages.findIndex(item => item.id === messageId);
    this.messages[index] = {
      ...this.messages[index], translation: this.messages[index].translation ?? translation, updatedAt,
    };
    return { ...this.messages[index] };
  }

  async beginExchange(input: BeginExchangeInput): Promise<BeginExchangeResult> {
    const existingUser = this.messages.find(
      item => item.conversationId === input.userMessage.conversationId
        && item.clientRequestId === input.userMessage.clientRequestId,
    );
    if (existingUser) {
      const assistantMessage = this.messages.find(
        item => item.replyToMessageId === existingUser.id && item.role === 'assistant',
      );
      if (!assistantMessage) throw new Error('assistant reply missing');
      if (assistantMessage.status === 'interrupted') {
        const restarted = {
          ...assistantMessage,
          status: 'streaming' as const,
          content: '',
          updatedAt: input.assistantMessage.updatedAt,
        };
        this.updateAssistant(assistantMessage.id, restarted);
        return { created: true, userMessage: existingUser, assistantMessage: restarted };
      }
      return { created: false, assistantMessage };
    }
    const conversationIndex = this.conversations.findIndex(
      item => item.id === input.userMessage.conversationId && item.userId === input.userId,
    );
    if (conversationIndex < 0) throw new Error('conversation not found');
    const next = this.conversations[conversationIndex].nextMessageSequence;
    const userMessage = { ...input.userMessage, sequence: next };
    const assistantMessage = { ...input.assistantMessage, sequence: next + 1 };
    this.conversations[conversationIndex] = {
      ...this.conversations[conversationIndex],
      nextMessageSequence: next + 2,
    };
    this.messages.push(userMessage, assistantMessage);
    return {
      created: true,
      userMessage,
      assistantMessage,
    };
  }

  async completeAssistant(
    userId: string,
    _conversationId: string,
    messageId: string,
    content: string,
    usage: AIUsage,
    grammarGroups: GrammarOccurrenceGroup[],
    toolEvents: Array<Extract<ChatEvent, { type: 'tool.call' | 'tool.result' }>>,
    updatedAt: Date,
  ): Promise<Correction[]> {
    const assistant = this.messages.find(item => item.id === messageId);
    if (!assistant?.replyToMessageId) throw new Error('assistant reply missing');
    const corrections: Correction[] = [];
    for (const group of grammarGroups) {
      const occurrenceKey = `${assistant.replyToMessageId}:${group.errorType}`;
      if (this.grammarOccurrences.has(occurrenceKey)) continue;
      this.grammarOccurrences.set(occurrenceKey, group);
      const pattern = this.grammarPatterns.get(group.errorType) ?? { count: 0, corrected: false };
      pattern.count += 1;
      if (pattern.count === 2 && !pattern.corrected) {
        pattern.corrected = true;
        corrections.push(...group.details);
      }
      this.grammarPatterns.set(group.errorType, pattern);
    }
    this.updateAssistant(messageId, {
      content,
      status: 'completed',
      correctionJson: corrections.length ? JSON.stringify(corrections) : undefined,
      toolEventsJson: toolEvents.length ? JSON.stringify(toolEvents) : undefined,
      updatedAt,
    });
    this.usageByMessage.set(messageId, usage);
    const utcDate = updatedAt.toISOString().slice(0, 10);
    const key = `${userId}:${utcDate}`;
    this.dailyChatTokens.set(
      key,
      (this.dailyChatTokens.get(key) ?? 0) + usage.inputTokens + usage.outputTokens,
    );
    return corrections;
  }

  async interruptAssistant(
    _userId: string,
    _conversationId: string,
    messageId: string,
    content: string,
    updatedAt: Date,
  ): Promise<void> {
    this.updateAssistant(messageId, { content, status: 'interrupted', updatedAt });
  }

  async updateSummary(
    conversationId: string,
    userId: string,
    summary: string,
    foldedUntil: number,
  ): Promise<void> {
    const index = this.conversations.findIndex(
      item => item.id === conversationId && item.userId === userId,
    );
    if (index < 0) throw new Error('conversation not found');
    this.conversations[index] = {
      ...this.conversations[index],
      summary,
      summaryFoldedUntil: foldedUntil,
    };
  }

  private updateAssistant(messageId: string, patch: Partial<MessageRecord>): void {
    const index = this.messages.findIndex(item => item.id === messageId);
    if (index < 0) throw new Error('message not found');
    this.messages[index] = { ...this.messages[index], ...patch };
  }
}

export class FakeProductAIService implements ProductAIService {
  welcome = 'Hi! What would you like to talk about?';
  deltas = [ 'That ', 'sounds great!' ];
  failure?: Error;
  chatCalls = 0;
  grammarAnalysis: GrammarAnalysis = { explicitGrammarQuestion: false, errors: [] };
  grammarFailure?: Error;
  grammarAnalysisCalls = 0;
  requireGrammarStartedBeforeChat = false;
  readonly welcomeInputs: WelcomeInput[] = [];
  readonly chatInputs: ChatInput[] = [];
  readonly grammarInputs: GrammarAnalysisInput[] = [];
  vocabularyEnrichment: VocabularyEnrichment | null = {
    cnMeaning: '全麦面包',
    enMeaning: 'whole wheat bread',
    example: 'I bought whole wheat bread.',
    phonetic: '/hoʊl wiːt bred/',
  };
  vocabularyFailure?: Error;
  vocabularyCalls = 0;
  translation: TranslationResult = { translation: '这是一条翻译。' };
  translationFailure?: Error;
  translationCalls = 0;
  readonly translationInputs: TranslationInput[] = [];
  memoryExtraction: MemoryExtractionResult = {
    decisions: [{ shouldSave: false, reason: 'Nothing worth saving' }],
  };
  memoryExtractionFailure?: Error;
  memoryExtractionCalls = 0;
  readonly memoryExtractionInputs: MemoryExtractionInput[] = [];
  dailyLearningSummaryCalls = 0;
  /** 设置后，chat 会在 message.start 后发射一次 summary.update 事件。 */
  summaryUpdate?: { summary: string; foldedUntil: number };

  async createWelcome(input: WelcomeInput): Promise<string> {
    this.welcomeInputs.push(input);
    return this.welcome;
  }

  async* chat(input: ChatInput): AsyncIterable<ChatEvent> {
    if (this.requireGrammarStartedBeforeChat && this.grammarAnalysisCalls === 0) {
      throw new Error('grammar analysis did not start before chat');
    }
    this.chatCalls += 1;
    this.chatInputs.push(input);
    yield { type: 'message.start', messageId: input.messageId };
    if (this.summaryUpdate) {
      yield {
        type: 'summary.update',
        summary: this.summaryUpdate.summary,
        foldedUntil: this.summaryUpdate.foldedUntil,
      };
    }
    const requiredExpression = input.requiredExpressions?.[0];
    if (input.tools && (requiredExpression || /how to say|怎么说|怎么表达/i.test(input.content))) {
      const explained = await input.tools.explainExpression({
        text: requiredExpression ?? '差点迟到',
        context: input.content,
      });
      if (explained) {
        yield {
          type: 'tool.call', toolCallId: 'tool-explain', name: 'explain_expression',
          input: { text: requiredExpression ?? '差点迟到', context: input.content },
        };
        yield { type: 'tool.result', toolCallId: 'tool-explain', output: explained };
      }
    }
    for (const delta of this.deltas) {
      yield { type: 'message.delta', messageId: input.messageId, delta };
    }
    if (this.failure) throw this.failure;
    yield {
      type: 'message.done',
      messageId: input.messageId,
      usage: { provider: 'fake', model: 'fake-chat', inputTokens: 3, outputTokens: 4 },
    };
  }

  async analyzeGrammar(input: GrammarAnalysisInput): Promise<GrammarAnalysis> {
    this.grammarAnalysisCalls += 1;
    this.grammarInputs.push(input);
    if (this.grammarFailure) throw this.grammarFailure;
    return this.grammarAnalysis;
  }

  async enrichVocabulary(): Promise<VocabularyEnrichment | null> {
    this.vocabularyCalls += 1;
    if (this.vocabularyFailure) throw this.vocabularyFailure;
    return this.vocabularyEnrichment;
  }

  async translate(input: TranslationInput): Promise<TranslationResult> {
    this.translationCalls += 1;
    this.translationInputs.push(input);
    if (this.translationFailure) throw this.translationFailure;
    return this.translation;
  }

  async generateDailyLearningSummary(
    input: DailyLearningSummaryInput,
  ): Promise<DailyLearningSummaryGeneration> {
    this.dailyLearningSummaryCalls += 1;
    return new DevelopmentProductAIService().generateDailyLearningSummary(input);
  }

  async extractMemories(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    this.memoryExtractionCalls += 1;
    this.memoryExtractionInputs.push(input);
    if (this.memoryExtractionFailure) throw this.memoryExtractionFailure;
    return this.memoryExtraction;
  }
}
