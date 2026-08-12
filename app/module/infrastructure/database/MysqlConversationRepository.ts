import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import Conversation from '../../../model/Conversation';
import Message from '../../../model/Message';
import AIUsageLog from '../../../model/AIUsageLog';
import type {
  AIUsage,
  Correction,
} from '../../ai/service/ProductAIService';
import type {
  BeginExchangeInput,
  BeginExchangeResult,
  ConversationListRecord,
  ConversationRecord,
  CreateConversationInput,
  MessageRecord,
} from '../../conversation/service/ConversationPorts';
import { ConversationRepository } from '../../conversation/service/ConversationPorts';
import type { GrammarOccurrenceGroup } from '../../grammar/service/GrammarPorts';
import { AppError } from '../../system/error/AppError';
import { IdGenerator } from '../../system/service/SystemPorts';
import { DatabaseService } from './DatabaseService';

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && error.code === 'ER_DUP_ENTRY';
}

function utcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

type QueryValue = string | number | Date | null;
type Connection = {
  query(
    sql: string,
    values: QueryValue[],
    callback: (error: Error | null, result: unknown) => void,
  ): void;
};

@SingletonProto({ name: 'ConversationRepository', accessLevel: AccessLevel.PUBLIC })
export class MysqlConversationRepository extends ConversationRepository {
  @Inject()
  private databaseService: DatabaseService;

  @Inject('IdGenerator')
  private ids: IdGenerator;

  async create(input: CreateConversationInput): Promise<ConversationRecord> {
    const realm = await this.databaseService.getRealm();
    await realm.transaction(async ({ connection }) => {
      await Conversation.create(input.conversation, { connection });
      await Message.create(input.welcomeMessage, { connection });
    });
    return input.conversation;
  }

  async listByUser(userId: string): Promise<ConversationListRecord[]> {
    const realm = await this.databaseService.getRealm();
    const conversations = await Conversation.find({ userId }).order('updatedAt', 'desc');
    const result = await realm.query(`
      SELECT m.*
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.user_id = ?
        AND m.sequence = (
          SELECT MAX(latest.sequence)
          FROM messages latest
          WHERE latest.conversation_id = m.conversation_id
        )
    `, [ userId ]);
    const lastMessages = new Map(
      (result.rows as unknown as Array<Record<string, unknown>>)
        .map(row => this.toMessageRow(row))
        .map(message => [ message.conversationId, message ]),
    );
    return conversations.map(item => ({
      ...this.toConversation(item),
      lastMessage: lastMessages.get(item.id),
    }));
  }

  async findByIdForUser(id: string, userId: string): Promise<ConversationRecord | null> {
    await this.databaseService.getRealm();
    const conversation = await Conversation.findOne({ id, userId });
    return conversation ? this.toConversation(conversation) : null;
  }

  async updateSummary(
    conversationId: string,
    userId: string,
    summary: string,
    foldedUntil: number,
  ): Promise<void> {
    await this.databaseService.getRealm();
    await Conversation.update(
      { id: conversationId, userId },
      { summary, summaryFoldedUntil: foldedUntil },
    );
  }

  async listMessages(id: string, userId: string): Promise<MessageRecord[] | null> {
    if (!(await this.findByIdForUser(id, userId))) return null;
    const messages = await Message.find({ conversationId: id }).order('sequence', 'asc');
    return messages.map(item => this.toMessage(item));
  }

  async findExchangeAssistant(
    conversationId: string,
    userId: string,
    clientRequestId: string,
  ): Promise<MessageRecord | null> {
    if (!(await this.findByIdForUser(conversationId, userId))) return null;
    const exchange = await this.findExistingExchange(conversationId, clientRequestId);
    return exchange?.assistantMessage ?? null;
  }

  async getDailyChatTokens(userId: string, expectedUtcDate: string): Promise<number> {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      SELECT token_count
      FROM daily_chat_token_usages
      WHERE user_id = ? AND usage_date = ?
      LIMIT 1
    `, [ userId, expectedUtcDate ]);
    const row = (result.rows as unknown as Array<Record<string, unknown>>)[0];
    return Number(row?.token_count ?? 0);
  }

  async findMessageForTranslation(userId: string, messageId: string): Promise<MessageRecord | null> {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      SELECT m.* FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = ? AND c.user_id = ? AND m.status = 'completed' AND m.content <> ''
      LIMIT 1
    `, [ messageId, userId ]);
    const row = (result.rows as unknown as Array<Record<string, unknown>>)[0];
    return row ? this.toMessageRow(row) : null;
  }

  async saveTranslation(
    userId: string,
    messageId: string,
    translation: string,
    updatedAt: Date,
  ): Promise<MessageRecord | null> {
    const realm = await this.databaseService.getRealm();
    await realm.query(`
      UPDATE messages m
      JOIN conversations c ON c.id = m.conversation_id
      SET m.translation = COALESCE(m.translation, ?), m.updated_at = ?
      WHERE m.id = ? AND c.user_id = ? AND m.status = 'completed' AND m.content <> ''
    `, [ translation, updatedAt, messageId, userId ]);
    return this.findMessageForTranslation(userId, messageId);
  }

  async beginExchange(input: BeginExchangeInput): Promise<BeginExchangeResult> {
    await this.databaseService.getRealm();
    if (!(await this.findByIdForUser(input.userMessage.conversationId, input.userId))) {
      throw new AppError('CONVERSATION_NOT_FOUND', '会话不存在', 404);
    }
    const existing = await this.findExistingExchange(
      input.userMessage.conversationId,
      input.userMessage.clientRequestId ?? '',
    );
    if (existing) return this.resumeOrReplay(existing, input.assistantMessage.updatedAt);

    const realm = await this.databaseService.getRealm();
    let created: Extract<BeginExchangeResult, { created: true }> | undefined;
    try {
      await realm.transaction(async ({ connection }) => {
        const rows = await this.query<Array<Record<string, unknown>>>(connection, `
          SELECT next_message_sequence
          FROM conversations
          WHERE id = ? AND user_id = ?
          FOR UPDATE
        `, [ input.userMessage.conversationId, input.userId ]);
        if (!rows[0]) throw new AppError('CONVERSATION_NOT_FOUND', '会话不存在', 404);
        const next = Number(rows[0].next_message_sequence);
        const userMessage: MessageRecord = { ...input.userMessage, sequence: next };
        const assistantMessage: MessageRecord = { ...input.assistantMessage, sequence: next + 1 };
        await this.query(connection, `
          UPDATE conversations
          SET next_message_sequence = ?
          WHERE id = ? AND user_id = ?
        `, [ next + 2, input.userMessage.conversationId, input.userId ]);
        await Message.create(userMessage, { connection });
        await Message.create(assistantMessage, { connection });
        created = { created: true, userMessage, assistantMessage };
      });
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      const raced = await this.findExistingExchange(
        input.userMessage.conversationId,
        input.userMessage.clientRequestId ?? '',
      );
      if (raced) return this.resumeOrReplay(raced, input.assistantMessage.updatedAt);
      throw error;
    }
    if (!created) throw new Error('message exchange transaction returned no result');
    return created;
  }

  async completeAssistant(
    userId: string,
    conversationId: string,
    messageId: string,
    content: string,
    usage: AIUsage,
    grammarGroups: GrammarOccurrenceGroup[],
    toolEvents: Array<Extract<import('../../ai/service/ProductAIService').ChatEvent, { type: 'tool.call' | 'tool.result' }>>,
    updatedAt: Date,
  ): Promise<Correction[]> {
    const realm = await this.databaseService.getRealm();
    return realm.transaction(async ({ connection }) => {
      const conversation = await Conversation.findOne({ id: conversationId, userId });
      if (!conversation) throw new AppError('CONVERSATION_NOT_FOUND', '会话不存在', 404);
      const assistant = await Message.findOne({
        id: messageId,
        conversationId,
        role: 'assistant',
      });
      if (!assistant?.replyToMessageId) {
        throw new AppError('MESSAGE_NOT_FOUND', '消息不存在', 404);
      }
      const corrections = await this.recordGrammarGroups(
        connection,
        userId,
        assistant.replyToMessageId,
        grammarGroups,
        updatedAt,
      );
      const updated = await Message.update(
        { id: messageId, conversationId, role: 'assistant' },
        {
          content,
          status: 'completed',
          correctionJson: corrections.length ? JSON.stringify(corrections) : null,
          toolEventsJson: toolEvents.length ? JSON.stringify(toolEvents) : null,
          updatedAt,
        },
        { connection },
      );
      if (updated !== 1) throw new AppError('MESSAGE_NOT_FOUND', '消息不存在', 404);
      await AIUsageLog.create({
        messageId,
        userId,
        conversationId,
        task: 'conversation.chat',
        provider: usage.provider,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        status: 'success',
        createdAt: updatedAt,
      }, { connection });
      const tokenCount = usage.inputTokens + usage.outputTokens;
      const usageDate = utcDate(updatedAt);
      await this.query(connection, `
        INSERT INTO daily_chat_token_usages (
          user_id, usage_date, token_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          token_count = token_count + VALUES(token_count),
          updated_at = VALUES(updated_at)
      `, [ userId, usageDate, tokenCount, updatedAt, updatedAt ]);
      await Conversation.update(
        { id: conversationId, userId },
        { updatedAt, memoryDirtyAt: updatedAt },
        { connection },
      );
      return corrections;
    });
  }

  private async recordGrammarGroups(
    connection: Connection,
    userId: string,
    userMessageId: string,
    grammarGroups: GrammarOccurrenceGroup[],
    now: Date,
  ): Promise<Correction[]> {
    const corrections: Correction[] = [];
    const groups = [ ...grammarGroups ].sort(
      (left, right) => left.errorType.localeCompare(right.errorType),
    );
    for (const group of groups) {
      await this.query(connection, `
        INSERT INTO grammar_error_patterns (
          id, user_id, error_type, occurrence_count, corrected_at, created_at, updated_at
        ) VALUES (?, ?, ?, 0, NULL, ?, ?)
        ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)
      `, [ this.ids.next(), userId, group.errorType, now, now ]);
      const patternRows = await this.query<Array<Record<string, unknown>>>(connection, `
        SELECT id, occurrence_count, corrected_at
        FROM grammar_error_patterns
        WHERE user_id = ? AND error_type = ?
        FOR UPDATE
      `, [ userId, group.errorType ]);
      const pattern = patternRows[0];
      if (!pattern) throw new Error('grammar pattern missing after upsert');
      const patternId = String(pattern.id);
      const existing = await this.query<Array<Record<string, unknown>>>(connection, `
        SELECT id
        FROM grammar_error_occurrences
        WHERE pattern_id = ? AND user_message_id = ?
        FOR UPDATE
      `, [ patternId, userMessageId ]);
      if (existing.length) continue;

      await this.query(connection, `
        INSERT INTO grammar_error_occurrences (
          id, pattern_id, user_message_id, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `, [ this.ids.next(), patternId, userMessageId, JSON.stringify(group.details), now ]);
      const occurrenceCount = Number(pattern.occurrence_count) + 1;
      const previousCorrectedAt = pattern.corrected_at
        ? new Date(String(pattern.corrected_at))
        : null;
      const shouldCorrect = occurrenceCount === 2 && !previousCorrectedAt;
      await this.query(connection, `
        UPDATE grammar_error_patterns
        SET occurrence_count = ?, corrected_at = ?, updated_at = ?
        WHERE id = ?
      `, [ occurrenceCount, shouldCorrect ? now : previousCorrectedAt, now, patternId ]);
      if (shouldCorrect) corrections.push(...group.details);
    }
    return corrections;
  }

  private query<T = unknown>(
    connection: Connection,
    sql: string,
    values: QueryValue[],
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      connection.query(sql, values, (error, result) => {
        if (error) reject(error);
        else resolve(result as T);
      });
    });
  }

  async interruptAssistant(
    userId: string,
    conversationId: string,
    messageId: string,
    content: string,
    updatedAt: Date,
  ): Promise<void> {
    await this.updateAssistant(
      userId,
      conversationId,
      messageId,
      { content, status: 'interrupted', updatedAt },
    );
  }

  private async updateAssistant(
    userId: string,
    conversationId: string,
    messageId: string,
    patch: { content: string; status: 'completed' | 'interrupted'; updatedAt: Date },
  ): Promise<void> {
    const realm = await this.databaseService.getRealm();
    await realm.transaction(async ({ connection }) => {
      const conversation = await Conversation.findOne({ id: conversationId, userId });
      if (!conversation) throw new AppError('CONVERSATION_NOT_FOUND', '会话不存在', 404);
      const updated = await Message.update(
        { id: messageId, conversationId, role: 'assistant' },
        patch,
        { connection },
      );
      if (updated !== 1) throw new AppError('MESSAGE_NOT_FOUND', '消息不存在', 404);
      await Conversation.update(
        { id: conversationId, userId },
        { updatedAt: patch.updatedAt, memoryDirtyAt: patch.updatedAt },
        { connection },
      );
    });
  }

  private async findExistingExchange(
    conversationId: string,
    clientRequestId: string,
  ): Promise<{ userMessage: MessageRecord; assistantMessage: MessageRecord } | null> {
    const userMessage = await Message.findOne({
      conversationId,
      clientRequestId,
      role: 'user',
    });
    if (!userMessage) return null;
    const assistant = await Message.findOne({
      conversationId,
      replyToMessageId: userMessage.id,
      role: 'assistant',
    });
    if (!assistant) {
      throw new AppError('ACCOUNT_PERSISTENCE_FAILED', '消息保存不完整', 500);
    }
    return {
      userMessage: this.toMessage(userMessage),
      assistantMessage: this.toMessage(assistant),
    };
  }

  private async resumeOrReplay(
    exchange: { userMessage: MessageRecord; assistantMessage: MessageRecord },
    updatedAt: Date,
  ): Promise<BeginExchangeResult> {
    if (exchange.assistantMessage.status !== 'interrupted') {
      return { created: false, assistantMessage: exchange.assistantMessage };
    }
    const updated = await Message.update(
      { id: exchange.assistantMessage.id, status: 'interrupted' },
      { status: 'streaming', content: '', updatedAt },
    );
    if (updated !== 1) {
      const current = await Message.findOne({ id: exchange.assistantMessage.id });
      if (!current) throw new AppError('MESSAGE_NOT_FOUND', '消息不存在', 404);
      return { created: false, assistantMessage: this.toMessage(current) };
    }
    return {
      created: true,
      userMessage: exchange.userMessage,
      assistantMessage: {
        ...exchange.assistantMessage,
        status: 'streaming',
        content: '',
        updatedAt,
      },
    };
  }

  private toConversation(item: Conversation): ConversationRecord {
    return {
      id: item.id,
      userId: item.userId,
      topic: item.topic,
      scene: item.scene ?? undefined,
      status: item.status,
      summary: item.summary ?? undefined,
      summaryFoldedUntil: item.summaryFoldedUntil ?? undefined,
      nextMessageSequence: Number(item.nextMessageSequence),
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    };
  }

  private toMessage(item: Message): MessageRecord {
    return {
      id: item.id,
      conversationId: item.conversationId,
      replyToMessageId: item.replyToMessageId ?? undefined,
      role: item.role,
      status: item.status,
      content: item.content,
      translation: item.translation ?? undefined,
      correctionJson: item.correctionJson ?? undefined,
      toolEventsJson: item.toolEventsJson ?? undefined,
      clientRequestId: item.clientRequestId ?? undefined,
      sequence: Number(item.sequence),
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    };
  }

  private toMessageRow(row: Record<string, unknown>): MessageRecord {
    return {
      id: String(row.id), conversationId: String(row.conversation_id),
      ...(row.reply_to_message_id ? { replyToMessageId: String(row.reply_to_message_id) } : {}),
      role: row.role as MessageRecord['role'], status: row.status as MessageRecord['status'],
      content: String(row.content),
      ...(row.translation ? { translation: String(row.translation) } : {}),
      ...(row.correction_json ? { correctionJson: String(row.correction_json) } : {}),
      ...(row.tool_events_json ? { toolEventsJson: String(row.tool_events_json) } : {}),
      ...(row.client_request_id ? { clientRequestId: String(row.client_request_id) } : {}),
      sequence: Number(row.sequence),
      createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)),
    };
  }
}
