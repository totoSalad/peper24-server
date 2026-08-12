import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import {
  ApplyMemoryCandidatesInput,
  MemoryRecord,
  MemoryRepository,
  MemorySourceMessage,
  MemoryStatus,
  MemoryType,
  PendingMemoryGroup,
} from '../../memory/service/MemoryPorts';
import { DatabaseService } from './DatabaseService';

type QueryValue = string | number | Date | null;
type Row = Record<string, unknown>;
type Connection = { query(sql: string, values: QueryValue[], callback: (error: Error | null, result: unknown) => void): void };

function toDate(value: unknown): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
}

function isConcurrentWriteConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'ER_DUP_ENTRY' || error.code === 'ER_LOCK_DEADLOCK');
}

@SingletonProto({ name: 'MemoryRepository', accessLevel: AccessLevel.PUBLIC })
export class MysqlMemoryRepository extends MemoryRepository {
  @Inject() private databaseService: DatabaseService;

  async list(userId: string, now: Date): Promise<MemoryRecord[]> {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      SELECT * FROM memories
      WHERE user_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY type, normalized_key
    `, [ userId, now ]);
    return (result.rows as unknown as Row[]).map(row => this.toRecord(row));
  }

  async update(
    userId: string,
    id: string,
    content: string,
    summary: string,
    now: Date,
  ) {
    const realm = await this.databaseService.getRealm();
    return realm.transaction(async ({ connection }) => {
      const rows = await this.query<Row[]>(connection,
        "SELECT * FROM memories WHERE id = ? AND user_id = ? AND status = 'active' FOR UPDATE",
        [ id, userId ]);
      if (!rows[0]) return null;
      const before = this.toRecord(rows[0]);
      await this.query(connection,
        'UPDATE memories SET content = ?, summary = ?, confidence = 1, updated_at = ? WHERE id = ?',
        [ content, summary, now, id ]);
      const after = { ...before, content, summary, confidence: 1, updatedAt: now };
      await this.log(connection, id, userId, 'correct', before, after, now);
      return after;
    });
  }

  async delete(userId: string, id: string, now: Date): Promise<boolean> {
    const realm = await this.databaseService.getRealm();
    return realm.transaction(async ({ connection }) => {
      const rows = await this.query<Row[]>(connection,
        "SELECT * FROM memories WHERE id = ? AND user_id = ? AND status = 'active' FOR UPDATE",
        [ id, userId ]);
      if (!rows[0]) return false;
      const before = this.toRecord(rows[0]);
      await this.query(connection,
        "UPDATE memories SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?",
        [ now, now, id ]);
      await this.log(connection, id, userId, 'delete', before,
        { ...before, status: 'deleted', deletedAt: now, updatedAt: now }, now);
      return true;
    });
  }

  async loadPendingMemoryGroups(input: {
    userId: string;
    minimumMessages: number;
    maximumMessagesPerGroup: number;
    maximumGroups: number;
  }): Promise<PendingMemoryGroup[]> {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      WITH ranked AS (
        SELECT m.id, m.conversation_id, c.user_id, m.role, m.content, m.sequence, m.created_at,
          COUNT(*) OVER (PARTITION BY c.user_id, m.conversation_id) AS pending_count,
          ROW_NUMBER() OVER (
            PARTITION BY c.user_id, m.conversation_id
            ORDER BY m.created_at, m.sequence, m.id
          ) AS message_order,
          MIN(m.created_at) OVER (PARTITION BY c.user_id, m.conversation_id) AS first_pending_at
        FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = ? AND m.role = 'user' AND m.status = 'completed'
          AND m.memory_scanned_at IS NULL
      ), eligible_groups AS (
        SELECT user_id, conversation_id, MIN(first_pending_at) AS first_pending_at
        FROM ranked
        WHERE pending_count >= ?
        GROUP BY user_id, conversation_id
        ORDER BY first_pending_at, conversation_id
        LIMIT ?
      )
      SELECT ranked.*
      FROM ranked JOIN eligible_groups USING (user_id, conversation_id)
      WHERE ranked.message_order <= ?
      ORDER BY eligible_groups.first_pending_at, ranked.conversation_id,
        ranked.created_at, ranked.sequence, ranked.id
    `, [ input.userId, input.minimumMessages, input.maximumGroups,
      input.maximumMessagesPerGroup ]);
    const groups = new Map<string, PendingMemoryGroup>();
    for (const row of result.rows as unknown as Row[]) {
      const userId = String(row.user_id);
      const conversationId = String(row.conversation_id);
      const key = `${userId}\u0000${conversationId}`;
      const group = groups.get(key) ?? { userId, conversationId, targetMessages: [] };
      group.targetMessages.push({
        id: String(row.id), conversationId, userId, role: 'user', content: String(row.content),
        sequence: Number(row.sequence), createdAt: toDate(row.created_at),
      });
      groups.set(key, group);
    }
    return [ ...groups.values() ];
  }

  async loadExtractionContext(
    conversationId: string,
    userId: string,
    targetMessages: MemorySourceMessage[],
  ): Promise<MemorySourceMessage[]> {
    if (!targetMessages.length) return [];
    const orderedTargets = [ ...targetMessages ].sort((left, right) =>
      left.sequence - right.sequence);
    const first = orderedTargets[0];
    const last = orderedTargets[orderedTargets.length - 1];
    const realm = await this.databaseService.getRealm();
    const previous = await realm.query(`
      SELECT m.id, m.conversation_id, c.user_id, m.role, m.content, m.sequence, m.created_at
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ? AND c.user_id = ? AND m.status = 'completed'
        AND m.sequence < ?
      ORDER BY m.sequence DESC
      LIMIT 2
    `, [ conversationId, userId, first.sequence ]);
    const range = await realm.query(`
      SELECT m.id, m.conversation_id, c.user_id, m.role, m.content, m.sequence, m.created_at
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ? AND c.user_id = ? AND m.status = 'completed'
        AND m.sequence BETWEEN ? AND ?
      ORDER BY m.sequence ASC
    `, [
      conversationId, userId,
      first.sequence, last.sequence,
    ]);
    const rows = [
      ...(previous.rows as unknown as Row[]),
      ...(range.rows as unknown as Row[]),
    ];
    const messages = new Map<string, MemorySourceMessage>();
    for (const row of rows) {
      const item = {
        id: String(row.id), conversationId: String(row.conversation_id), userId: String(row.user_id),
        role: row.role as 'user' | 'assistant', content: String(row.content),
        sequence: Number(row.sequence), createdAt: toDate(row.created_at),
      };
      messages.set(item.id, item);
    }
    return [ ...messages.values() ].sort((left, right) => left.sequence - right.sequence);
  }

  async markMessagesScanned(userId: string, messageIds: string[], scannedAt: Date): Promise<void> {
    if (!messageIds.length) return;
    const realm = await this.databaseService.getRealm();
    const placeholders = messageIds.map(() => '?').join(', ');
    await realm.query(`
      UPDATE messages m JOIN conversations c ON c.id = m.conversation_id
      SET m.memory_scanned_at = ?
      WHERE c.user_id = ? AND m.role = 'user' AND m.memory_scanned_at IS NULL
        AND m.id IN (${placeholders})
    `, [ scannedAt, userId, ...messageIds ]);
  }

  async applyCandidates(input: ApplyMemoryCandidatesInput): Promise<MemoryRecord[]> {
    try {
      return await this.applyCandidatesTransaction(input);
    } catch (error) {
      if (!isConcurrentWriteConflict(error)) throw error;
      return this.applyCandidatesTransaction(input);
    }
  }

  private async applyCandidatesTransaction(
    input: ApplyMemoryCandidatesInput,
  ): Promise<MemoryRecord[]> {
    const realm = await this.databaseService.getRealm();
    return realm.transaction(async ({ connection }) => {
      const changed: MemoryRecord[] = [];
      for (const candidate of input.candidates) {
        const rows = await this.query<Row[]>(connection, `
          SELECT * FROM memories WHERE user_id = ? AND type = ? AND normalized_key = ?
          ORDER BY FIELD(status, 'active', 'deleted', 'superseded') FOR UPDATE
        `, [ input.userId, candidate.type, candidate.normalizedKey ]);
        const activeRow = rows.find(row => row.status === 'active');
        if (activeRow) {
          const current = this.toRecord(activeRow);
          await this.insertSources(connection, current.id, candidate.sourceMessageIds, input.now);
          if (current.summary !== candidate.summary) {
            const after = {
              ...current, summary: candidate.summary, admissionScore: candidate.admissionScore,
              explicitlyRequested: candidate.explicitlyRequested,
              admissionReason: candidate.admissionReason, assessmentJson: candidate.assessmentJson,
              confidence: candidate.confidence,
              expiresAt: input.expiryFor(candidate), updatedAt: input.now,
            };
            await this.query(connection, `
              UPDATE memories SET summary = ?, confidence = ?, admission_score = ?,
                explicitly_requested = ?, admission_reason = ?, assessment_json = ?,
                expires_at = ?, updated_at = ? WHERE id = ?
            `, [ after.summary, after.confidence, after.admissionScore,
              after.explicitlyRequested ? 1 : 0, after.admissionReason, after.assessmentJson,
              after.expiresAt ?? null, input.now, current.id ]);
            await this.log(connection, current.id, input.userId, 'replace', current, after, input.now);
            changed.push(after);
          }
          continue;
        }
        const deletedRow = rows.find(row => row.status === 'deleted');
        if (deletedRow) {
          const placeholders = candidate.sourceMessageIds.map(() => '?').join(', ');
          const known = await this.query<Row[]>(connection, `
            SELECT DISTINCT message_id FROM memory_sources
            WHERE memory_id = ? AND message_id IN (${placeholders})
          `, [ String(deletedRow.id), ...candidate.sourceMessageIds ]);
          if (known.length === candidate.sourceMessageIds.length) continue;
          const before = this.toRecord(deletedRow);
          const after: MemoryRecord = {
            ...before,
            summary: candidate.summary,
            confidence: candidate.confidence,
            admissionScore: candidate.admissionScore,
            explicitlyRequested: candidate.explicitlyRequested,
            admissionReason: candidate.admissionReason,
            assessmentJson: candidate.assessmentJson,
            status: 'active',
            expiresAt: input.expiryFor(candidate),
            deletedAt: undefined,
            updatedAt: input.now,
          };
          await this.query(connection, `
            UPDATE memories SET summary = ?, confidence = ?, admission_score = ?,
              explicitly_requested = ?, admission_reason = ?, assessment_json = ?,
              status = 'active', expires_at = ?, deleted_at = NULL, updated_at = ? WHERE id = ?
          `, [ after.summary, after.confidence, after.admissionScore,
            after.explicitlyRequested ? 1 : 0, after.admissionReason, after.assessmentJson,
            after.expiresAt ?? null, input.now, after.id ]);
          await this.insertSources(connection, after.id, candidate.sourceMessageIds, input.now);
          await this.log(connection, after.id, input.userId, 'add', before, after, input.now);
          changed.push(after);
          continue;
        }
        const supersededRow = rows.find(row => row.status === 'superseded');
        if (supersededRow) {
          const before = this.toRecord(supersededRow);
          const after: MemoryRecord = {
            ...before,
            summary: candidate.summary,
            confidence: candidate.confidence,
            admissionScore: candidate.admissionScore,
            explicitlyRequested: candidate.explicitlyRequested,
            admissionReason: candidate.admissionReason,
            assessmentJson: candidate.assessmentJson,
            status: 'active',
            expiresAt: input.expiryFor(candidate),
            updatedAt: input.now,
          };
          await this.query(connection, `
            UPDATE memories SET summary = ?, confidence = ?, admission_score = ?,
              explicitly_requested = ?, admission_reason = ?, assessment_json = ?,
              status = 'active', expires_at = ?, updated_at = ? WHERE id = ?
          `, [ after.summary, after.confidence, after.admissionScore,
            after.explicitlyRequested ? 1 : 0, after.admissionReason, after.assessmentJson,
            after.expiresAt ?? null, input.now, after.id ]);
          await this.insertSources(connection, after.id, candidate.sourceMessageIds, input.now);
          await this.log(connection, after.id, input.userId, 'restore', before, after, input.now);
          changed.push(after);
          continue;
        }
        const memory = input.create(candidate);
        await this.query(connection, `
          INSERT INTO memories (
            id, user_id, type, content, summary, normalized_key, confidence,
            admission_score, explicitly_requested, admission_reason, assessment_json, status,
            expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
        `, [ memory.id, memory.userId, memory.type, memory.content, memory.summary, memory.normalizedKey,
          memory.confidence, memory.admissionScore, memory.explicitlyRequested ? 1 : 0,
          memory.admissionReason, memory.assessmentJson, memory.expiresAt ?? null,
          memory.createdAt, memory.updatedAt ]);
        await this.insertSources(connection, memory.id, candidate.sourceMessageIds, input.now);
        await this.log(connection, memory.id, input.userId, 'add', null, memory, input.now);
        changed.push(memory);
      }
      for (const type of new Set(input.candidates.map(item => item.type))) {
        await this.enforceLimit(connection, input, type);
      }
      await this.enforceLongTermLimit(connection, input);
      return changed;
    });
  }

  private async enforceLimit(
    connection: Connection,
    input: ApplyMemoryCandidatesInput,
    type: MemoryType,
  ): Promise<void> {
    const limit = input.limitFor(type);
    if (limit === undefined) return;
    const rows = await this.query<Row[]>(connection, `
      SELECT * FROM memories
      WHERE user_id = ? AND type = ? AND status = 'active'
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY admission_score DESC, explicitly_requested DESC,
        updated_at DESC, created_at DESC, id DESC
      FOR UPDATE
    `, [ input.userId, type, input.now ]);
    for (const row of rows.slice(limit)) {
      const before = this.toRecord(row);
      const after: MemoryRecord = { ...before, status: 'superseded', updatedAt: input.now };
      await this.query(connection,
        "UPDATE memories SET status = 'superseded', updated_at = ? WHERE id = ?",
        [ input.now, before.id ]);
      await this.log(connection, before.id, input.userId, 'evict', before, after, input.now);
    }
  }

  private async enforceLongTermLimit(
    connection: Connection,
    input: ApplyMemoryCandidatesInput,
  ): Promise<void> {
    const rows = await this.query<Row[]>(connection, `
      SELECT * FROM memories
      WHERE user_id = ? AND type <> 'short_term' AND status = 'active'
      ORDER BY admission_score DESC, explicitly_requested DESC,
        updated_at DESC, created_at DESC, id DESC
      FOR UPDATE
    `, [ input.userId ]);
    for (const row of rows.slice(input.longTermLimit)) {
      const before = this.toRecord(row);
      const after: MemoryRecord = { ...before, status: 'superseded', updatedAt: input.now };
      await this.query(connection,
        "UPDATE memories SET status = 'superseded', updated_at = ? WHERE id = ?",
        [ input.now, before.id ]);
      await this.log(connection, before.id, input.userId, 'evict', before, after, input.now);
    }
  }

  private async insertSources(connection: Connection, memoryId: string, messageIds: string[], now: Date) {
    for (const messageId of messageIds) {
      await this.query(connection,
        'INSERT IGNORE INTO memory_sources (memory_id, message_id, created_at) VALUES (?, ?, ?)',
        [ memoryId, messageId, now ]);
    }
  }

  private async log(
    connection: Connection, memoryId: string, userId: string, action: string,
    before: MemoryRecord | null, after: MemoryRecord | null, now: Date,
  ) {
    await this.query(connection, `
      INSERT INTO memory_change_logs (memory_id, user_id, action, before_json, after_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [ memoryId, userId, action, before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null, now ]);
  }

  private toRecord(row: Row): MemoryRecord {
    return {
      id: String(row.id), userId: String(row.user_id), type: row.type as MemoryType,
      content: String(row.content), summary: String(row.summary),
      normalizedKey: String(row.normalized_key),
      confidence: Number(row.confidence), status: row.status as MemoryStatus,
      admissionScore: Number(row.admission_score),
      explicitlyRequested: Boolean(row.explicitly_requested),
      admissionReason: String(row.admission_reason),
      assessmentJson: String(row.assessment_json),
      expiresAt: row.expires_at ? toDate(row.expires_at) : undefined,
      deletedAt: row.deleted_at ? toDate(row.deleted_at) : undefined,
      createdAt: toDate(row.created_at), updatedAt: toDate(row.updated_at),
    };
  }

  private query<T = unknown>(connection: Connection, sql: string, values: QueryValue[]): Promise<T> {
    return new Promise((resolve, reject) => connection.query(sql, values, (error, result) => {
      if (error) reject(error); else resolve(result as T);
    }));
  }
}
