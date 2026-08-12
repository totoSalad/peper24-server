import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import type { Correction, GrammarErrorType } from '../../ai/service/ProductAIService';
import type {
  DailyLearningMetrics,
  DailyLearningSummaryContent,
  DailyLearningSummaryRecord,
  SummaryDateRange,
  SummaryReviewResult,
} from '../../learning-summary/service/LearningSummaryPorts';
import { LearningSummaryRepository } from '../../learning-summary/service/LearningSummaryPorts';
import { DatabaseService } from './DatabaseService';

type QueryValue = string | number | Date | null;
type Row = Record<string, unknown>;
type Connection = {
  query(
    sql: string,
    values: QueryValue[],
    callback: (error: Error | null, result: unknown) => void,
  ): void;
};

function json<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function date(value: unknown): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
}

function sqlDate(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = date(value);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

@SingletonProto({ name: 'LearningSummaryRepository', accessLevel: AccessLevel.PUBLIC })
export class MysqlLearningSummaryRepository extends LearningSummaryRepository {
  @Inject() private databaseService: DatabaseService;

  async aggregate(userId: string, range: SummaryDateRange): Promise<DailyLearningMetrics | null> {
    const realm = await this.databaseService.getRealm();
    const [ activityResult, tokenResult, grammarResult, vocabularyResult, reviewResult ] = await Promise.all([
      realm.query(`
        SELECT COUNT(DISTINCT c.id) AS conversation_count, COUNT(*) AS message_count
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = ? AND m.role = 'user' AND m.status = 'completed'
          AND m.created_at >= ? AND m.created_at < ?
      `, [ userId, range.from, range.to ]),
      realm.query(`
        SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS token_count
        FROM ai_usage_logs
        WHERE user_id = ? AND task = 'conversation.chat' AND status = 'success'
          AND created_at >= ? AND created_at < ?
      `, [ userId, range.from, range.to ]),
      realm.query(`
        SELECT p.error_type, o.details_json
        FROM grammar_error_occurrences o
        JOIN grammar_error_patterns p ON p.id = o.pattern_id
        WHERE p.user_id = ? AND o.created_at >= ? AND o.created_at < ?
        ORDER BY o.created_at ASC, o.id ASC
      `, [ userId, range.from, range.to ]),
      realm.query(`
        SELECT expression
        FROM vocabularies
        WHERE user_id = ? AND created_at >= ? AND created_at < ?
        ORDER BY created_at ASC, id ASC
      `, [ userId, range.from, range.to ]),
      realm.query(`
        SELECT result
        FROM review_logs
        WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at < ?
        ORDER BY reviewed_at ASC, id ASC
      `, [ userId, range.from, range.to ]),
    ]);

    const activity = (activityResult.rows as unknown as Row[])[0] ?? {};
    const userMessageCount = Number(activity.message_count ?? 0);
    const vocabularyRows = vocabularyResult.rows as unknown as Row[];
    const reviewRows = reviewResult.rows as unknown as Row[];
    if (userMessageCount === 0 && vocabularyRows.length === 0 && reviewRows.length === 0) return null;

    const grammarGroups = new Map<GrammarErrorType, Correction[]>();
    for (const row of grammarResult.rows as unknown as Row[]) {
      const errorType = row.error_type as GrammarErrorType;
      const details = json<Correction[]>(row.details_json);
      grammarGroups.set(errorType, [ ...(grammarGroups.get(errorType) ?? []), ...details ]);
    }
    const grammar = [ ...grammarGroups.entries() ]
      .map(([ errorType, details ]) => ({
        errorType,
        count: details.length,
        examples: details.slice(0, 2),
      }))
      .sort((left, right) => right.count - left.count || left.errorType.localeCompare(right.errorType));
    const reviewResults: Record<SummaryReviewResult, number> = {
      again: 0, hard: 0, good: 0, easy: 0,
    };
    for (const row of reviewRows) {
      const result = row.result as SummaryReviewResult;
      if (result in reviewResults) reviewResults[result] += 1;
    }
    const tokenRow = (tokenResult.rows as unknown as Row[])[0] ?? {};
    return {
      conversationCount: Number(activity.conversation_count ?? 0),
      userMessageCount,
      chatTokens: Number(tokenRow.token_count ?? 0),
      grammarErrorCount: grammar.reduce((sum, item) => sum + item.count, 0),
      grammar,
      newVocabularyCount: vocabularyRows.length,
      newVocabulary: vocabularyRows.slice(0, 20).map(row => String(row.expression)),
      reviewedCount: reviewRows.length,
      reviewResults,
    };
  }

  async find(userId: string, summaryDate: string): Promise<DailyLearningSummaryRecord | null> {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      SELECT * FROM daily_learning_summaries
      WHERE user_id = ? AND summary_date = ? LIMIT 1
    `, [ userId, summaryDate ]);
    const row = (result.rows as unknown as Row[])[0];
    return row ? this.toRecord(row) : null;
  }

  async list(userId: string, cursor: string | undefined, limit: number) {
    const realm = await this.databaseService.getRealm();
    const result = cursor
      ? await realm.query(`
          SELECT * FROM daily_learning_summaries
          WHERE user_id = ? AND summary_date < ? AND status = 'completed'
          ORDER BY summary_date DESC LIMIT ?
        `, [ userId, cursor, limit ])
      : await realm.query(`
          SELECT * FROM daily_learning_summaries
          WHERE user_id = ? AND status = 'completed'
          ORDER BY summary_date DESC LIMIT ?
        `, [ userId, limit ]);
    return (result.rows as unknown as Row[]).map(row => this.toRecord(row));
  }

  async claim(input: {
    id: string; userId: string; date: string; timezone: string; sourceVersion: string;
    metrics: DailyLearningMetrics; now: Date;
  }): Promise<boolean> {
    const realm = await this.databaseService.getRealm();
    return realm.transaction(async ({ connection }) => {
      const rows = await this.query<Row[]>(connection, `
        SELECT * FROM daily_learning_summaries
        WHERE user_id = ? AND summary_date = ? FOR UPDATE
      `, [ input.userId, input.date ]);
      const current = rows[0];
      if (current?.finalized_at) return false;
      if (current?.source_version === input.sourceVersion) {
        if (current.status === 'completed') return false;
        const staleAt = new Date(input.now.getTime() - 5 * 60 * 1000);
        if (current.status === 'generating' && date(current.updated_at) > staleAt) return false;
      }
      if (current) {
        await this.query(connection, `
          UPDATE daily_learning_summaries
          SET status = 'generating', source_version = ?, metrics_json = ?,
              timezone = ?, updated_at = ?
          WHERE id = ?
        `, [ input.sourceVersion, JSON.stringify(input.metrics), input.timezone, input.now,
          String(current.id) ]);
      } else {
        await this.query(connection, `
          INSERT INTO daily_learning_summaries (
            id, user_id, summary_date, timezone, status, source_version,
            metrics_json, content_json, provider, model, input_tokens, output_tokens,
            retry_count, generated_at, finalized_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'generating', ?, ?, NULL, NULL, NULL, 0, 0, 0, NULL, NULL, ?, ?)
        `, [ input.id, input.userId, input.date, input.timezone, input.sourceVersion,
          JSON.stringify(input.metrics), input.now, input.now ]);
      }
      return true;
    });
  }

  async complete(input: {
    userId: string; date: string; sourceVersion: string;
    content: DailyLearningSummaryContent; usage: import('../../ai/service/ProductAIService').AIUsage;
    now: Date;
  }): Promise<void> {
    const realm = await this.databaseService.getRealm();
    await realm.query(`
      UPDATE daily_learning_summaries
      SET status = 'completed', content_json = ?, provider = ?, model = ?,
          input_tokens = ?, output_tokens = ?, generated_at = ?, updated_at = ?
      WHERE user_id = ? AND summary_date = ? AND source_version = ?
    `, [ JSON.stringify(input.content), input.usage.provider, input.usage.model,
      input.usage.inputTokens, input.usage.outputTokens, input.now, input.now,
      input.userId, input.date, input.sourceVersion ]);
  }

  async listRecentlyActiveUserIds(from: Date, to: Date): Promise<string[]> {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      SELECT DISTINCT activity.user_id FROM (
        SELECT c.user_id FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.role = 'user' AND m.status = 'completed'
          AND m.created_at >= ? AND m.created_at < ?
        UNION ALL
        SELECT user_id FROM vocabularies WHERE created_at >= ? AND created_at < ?
        UNION ALL
        SELECT user_id FROM review_logs WHERE reviewed_at >= ? AND reviewed_at < ?
      ) activity
      LIMIT 500
    `, [ from, to, from, to, from, to ]);
    return (result.rows as unknown as Row[]).map(row => String(row.user_id));
  }

  async finalizeBefore(summaryDate: string, now: Date): Promise<void> {
    const realm = await this.databaseService.getRealm();
    await realm.query(`
      UPDATE daily_learning_summaries
      SET finalized_at = ?, updated_at = ?
      WHERE summary_date < ? AND status = 'completed' AND finalized_at IS NULL
    `, [ now, now, summaryDate ]);
  }

  private toRecord(row: Row): DailyLearningSummaryRecord {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      summaryDate: sqlDate(row.summary_date),
      timezone: String(row.timezone),
      status: row.status as DailyLearningSummaryRecord['status'],
      sourceVersion: String(row.source_version),
      metrics: json<DailyLearningMetrics>(row.metrics_json),
      ...(row.content_json
        ? { content: json<DailyLearningSummaryContent>(row.content_json) }
        : {}),
      ...(row.provider ? {
        usage: {
          provider: String(row.provider), model: String(row.model),
          inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens),
        },
      } : {}),
      retryCount: Number(row.retry_count),
      ...(row.generated_at ? { generatedAt: date(row.generated_at) } : {}),
      ...(row.finalized_at ? { finalizedAt: date(row.finalized_at) } : {}),
      createdAt: date(row.created_at),
      updatedAt: date(row.updated_at),
    };
  }

  private query<T = unknown>(connection: Connection, sql: string, values: QueryValue[]): Promise<T> {
    return new Promise((resolve, reject) => connection.query(sql, values, (error, result) => {
      if (error) reject(error); else resolve(result as T);
    }));
  }
}
