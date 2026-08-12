import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import { scheduleReview } from '../../vocabulary/service/ReviewScheduler';
import {
  type ReviewOutcome,
  type ReviewStateRecord,
  type SaveVocabularyInput,
  type SourceMessage,
  type VocabularyDetail,
  type VocabularyRecord,
  VocabularyRepository,
} from '../../vocabulary/service/VocabularyPorts';
import { DatabaseService } from './DatabaseService';

type QueryValue = string | number | Date | null;
type Row = Record<string, unknown>;
type Connection = { query(sql: string, values: QueryValue[], callback: (error: Error | null, result: unknown) => void): void };

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && error.code === 'ER_DUP_ENTRY';
}

function isConcurrentWriteConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'ER_DUP_ENTRY' || error.code === 'ER_LOCK_DEADLOCK');
}

function toDate(value: unknown): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
}

@SingletonProto({ name: 'VocabularyRepository', accessLevel: AccessLevel.PUBLIC })
export class MysqlVocabularyRepository extends VocabularyRepository {
  @Inject()
  private databaseService: DatabaseService;

  async findSourceMessage(userId: string, messageId: string): Promise<SourceMessage | null> {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      SELECT m.id, m.content
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = ? AND c.user_id = ?
      LIMIT 1
    `, [ messageId, userId ]);
    const rows = result.rows as unknown as Row[];
    return rows[0] ? { id: String(rows[0].id), content: String(rows[0].content) } : null;
  }

  async save(input: SaveVocabularyInput): Promise<VocabularyRecord> {
    try {
      return await this.saveTransaction(input);
    } catch (error) {
      if (!isConcurrentWriteConflict(error)) throw error;
      return this.saveTransaction(input);
    }
  }

  private async saveTransaction(input: SaveVocabularyInput): Promise<VocabularyRecord> {
    const realm = await this.databaseService.getRealm();
    return realm.transaction(async ({ connection }) => {
      const existing = await this.query<Row[]>(connection, `
        SELECT * FROM vocabularies
        WHERE user_id = ? AND normalized_expression = ?
        FOR UPDATE
      `, [ input.vocabulary.userId, input.vocabulary.normalizedExpression ]);
      let vocabulary = existing[0] ? this.toVocabulary(existing[0]) : input.vocabulary;
      if (!existing[0]) {
        await this.query(connection, `
          INSERT INTO vocabularies (
            id, user_id, original_expression, expression, normalized_expression, detail,
            last_encountered_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          vocabulary.id, vocabulary.userId, vocabulary.originalExpression,
          vocabulary.expression, vocabulary.normalizedExpression,
          JSON.stringify(vocabulary.detail),
          vocabulary.lastEncounteredAt, vocabulary.createdAt, vocabulary.updatedAt,
        ]);
        await this.query(connection, `
          INSERT INTO review_states (
            vocabulary_id, repetitions, interval_days, easiness_factor, next_review_at, updated_at
          ) VALUES (?, 0, 0, 2.5000, ?, ?)
        `, [ vocabulary.id, input.initialReviewState.nextReviewAt, input.initialReviewState.updatedAt ]);
      } else {
        await this.query(connection, `
          UPDATE vocabularies SET last_encountered_at = ?, updated_at = ? WHERE id = ?
        `, [ input.vocabulary.lastEncounteredAt, input.vocabulary.updatedAt, vocabulary.id ]);
        vocabulary = {
          ...vocabulary,
          lastEncounteredAt: input.vocabulary.lastEncounteredAt,
          updatedAt: input.vocabulary.updatedAt,
        };
      }
      await this.query(connection, `
        INSERT IGNORE INTO vocabulary_contexts (
          id, vocabulary_id, message_id, sentence, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `, [ input.context.id, vocabulary.id, input.context.messageId,
        input.context.sentence, input.context.createdAt ]);
      return vocabulary;
    });
  }

  async list(userId: string) {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      SELECT v.*, r.repetitions, r.interval_days, r.easiness_factor, r.next_review_at,
             r.updated_at AS review_updated_at
      FROM vocabularies v JOIN review_states r ON r.vocabulary_id = v.id
      WHERE v.user_id = ? ORDER BY v.last_encountered_at DESC
    `, [ userId ]);
    const rows = result.rows as unknown as Row[];
    return rows.map(row => ({ ...this.toVocabulary(row), reviewState: this.toReviewState(row) }));
  }

  async delete(userId: string, vocabularyId: string): Promise<boolean> {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query('DELETE FROM vocabularies WHERE id = ? AND user_id = ?',
      [ vocabularyId, userId ]);
    return Number(result.affectedRows ?? 0) === 1;
  }

  async listDue(userId: string, now: Date, limit: number) {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      SELECT v.*, r.repetitions, r.interval_days, r.easiness_factor, r.next_review_at,
             r.updated_at AS review_updated_at
      FROM review_states r JOIN vocabularies v ON v.id = r.vocabulary_id
      WHERE v.user_id = ? AND r.next_review_at <= ?
      ORDER BY r.next_review_at ASC LIMIT ?
    `, [ userId, now, limit ]);
    const rows = result.rows as unknown as Row[];
    return rows.map(row => ({ ...this.toVocabulary(row), reviewState: this.toReviewState(row) }));
  }

  async recordReview(input: {
    id: string; userId: string; vocabularyId: string; clientRequestId: string;
    result: 'again' | 'hard' | 'good' | 'easy'; score: number; reviewedAt: Date;
  }): Promise<ReviewOutcome | null> {
    const replay = await this.findReview(input.userId, input.clientRequestId);
    if (replay) return replay;
    const realm = await this.databaseService.getRealm();
    try {
      return await realm.transaction(async ({ connection }) => {
        const rows = await this.query<Row[]>(connection, `
          SELECT r.* FROM review_states r
          JOIN vocabularies v ON v.id = r.vocabulary_id
          WHERE r.vocabulary_id = ? AND v.user_id = ? FOR UPDATE
        `, [ input.vocabularyId, input.userId ]);
        if (!rows[0]) return null;
        const before = this.toReviewState(rows[0]);
        const after = scheduleReview(before, input.score, input.reviewedAt);
        await this.query(connection, `
          UPDATE review_states SET repetitions = ?, interval_days = ?, easiness_factor = ?,
            next_review_at = ?, updated_at = ? WHERE vocabulary_id = ?
        `, [ after.repetitions, after.intervalDays, after.easinessFactor,
          after.nextReviewAt, after.updatedAt, input.vocabularyId ]);
        await this.query(connection, `
          INSERT INTO review_logs (
            id, user_id, vocabulary_id, client_request_id, result, score,
            before_state_json, after_state_json, reviewed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [ input.id, input.userId, input.vocabularyId, input.clientRequestId,
          input.result, input.score, JSON.stringify(before), JSON.stringify(after), input.reviewedAt ]);
        return { ...after, result: input.result, score: input.score, reviewedAt: input.reviewedAt };
      });
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      return this.findReview(input.userId, input.clientRequestId);
    }
  }

  private async findReview(userId: string, clientRequestId: string): Promise<ReviewOutcome | null> {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      SELECT result, score, after_state_json, reviewed_at FROM review_logs
      WHERE user_id = ? AND client_request_id = ? LIMIT 1
    `, [ userId, clientRequestId ]);
    const rows = result.rows as unknown as Row[];
    if (!rows[0]) return null;
    const after = JSON.parse(String(rows[0].after_state_json)) as ReviewStateRecord;
    return {
      ...after,
      nextReviewAt: new Date(after.nextReviewAt),
      updatedAt: new Date(after.updatedAt),
      result: rows[0].result as ReviewOutcome['result'],
      score: Number(rows[0].score),
      reviewedAt: toDate(rows[0].reviewed_at),
    };
  }

  private toVocabulary(row: Row): VocabularyRecord {
    return {
      id: String(row.id), userId: String(row.user_id),
      originalExpression: String(row.original_expression), expression: String(row.expression),
      normalizedExpression: String(row.normalized_expression),
      detail: this.toDetail(row.detail),
      lastEncounteredAt: toDate(row.last_encountered_at),
      createdAt: toDate(row.created_at), updatedAt: toDate(row.updated_at),
    };
  }

  private toDetail(value: unknown): VocabularyDetail {
    const raw = typeof value === 'string'
      ? (JSON.parse(value) as Record<string, unknown> | null)
      : (value as Record<string, unknown> | null);
    return {
      cnMeaning: String(raw?.cnMeaning ?? ''),
      enMeaning: String(raw?.enMeaning ?? ''),
      example: String(raw?.example ?? ''),
      phonetic: String(raw?.phonetic ?? ''),
    };
  }

  private toReviewState(row: Row): ReviewStateRecord {
    return {
      vocabularyId: String(row.vocabulary_id ?? row.id),
      repetitions: Number(row.repetitions), intervalDays: Number(row.interval_days),
      easinessFactor: Number(row.easiness_factor), nextReviewAt: toDate(row.next_review_at),
      updatedAt: toDate(row.review_updated_at ?? row.updated_at),
    };
  }

  private query<T = unknown>(connection: Connection, sql: string, values: QueryValue[]): Promise<T> {
    return new Promise((resolve, reject) => connection.query(sql, values, (error, result) => {
      if (error) reject(error); else resolve(result as T);
    }));
  }
}
