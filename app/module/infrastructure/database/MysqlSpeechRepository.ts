import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import {
  SpeechRepository,
  type SpeechTransaction,
  type VoiceContentType,
  type VoiceRecordingRecord,
} from '../../speech/service/SpeechPorts';
import { DatabaseService } from './DatabaseService';

type Row = Record<string, unknown>;
type QueryValue = string | number | Date | null;
type Connection = {
  query(
    sql: string,
    values: QueryValue[],
    callback: (error: Error | null, result: unknown) => void,
  ): void;
};

function toDate(value: unknown): Date {
  return value instanceof Date ? new Date(value) : new Date(String(value));
}

@SingletonProto({ name: 'SpeechRepository', accessLevel: AccessLevel.PUBLIC })
export class MysqlSpeechRepository extends SpeechRepository {
  @Inject() private databaseService: DatabaseService;

  async createRecording(record: VoiceRecordingRecord): Promise<void> {
    const realm = await this.databaseService.getRealm();
    await realm.query(`
      INSERT INTO voice_recordings (
        id, user_id, message_id, oss_key, content_type, size_bytes, duration_ms, status,
        provider_task_id, transcript, error_code, expires_at, deleted_at, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, NULL, ?, ?)
    `, [ record.id, record.userId, record.objectKey, record.contentType, record.sizeBytes,
      record.status, record.expiresAt, record.createdAt, record.updatedAt ]);
  }

  async findRecording(userId: string, recordingId: string): Promise<VoiceRecordingRecord | null> {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      SELECT * FROM voice_recordings WHERE id = ? AND user_id = ? LIMIT 1
    `, [ recordingId, userId ]);
    return this.recordingFromResult(result);
  }

  async findRecordingByMessage(
    userId: string,
    messageId: string,
  ): Promise<VoiceRecordingRecord | null> {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      SELECT vr.*
      FROM voice_recordings vr
      JOIN messages m ON m.id = vr.message_id
      JOIN conversations c ON c.id = m.conversation_id
      WHERE vr.message_id = ? AND vr.user_id = ? AND c.user_id = ?
      LIMIT 1
    `, [ messageId, userId, userId ]);
    return this.recordingFromResult(result);
  }

  async findRecordingsByMessages(
    userId: string,
    messageIds: string[],
  ): Promise<VoiceRecordingRecord[]> {
    if (!messageIds.length) return [];
    const realm = await this.databaseService.getRealm();
    const placeholders = messageIds.map(() => '?').join(', ');
    const result = await realm.query(`
      SELECT vr.*
      FROM voice_recordings vr
      JOIN messages m ON m.id = vr.message_id
      JOIN conversations c ON c.id = m.conversation_id
      WHERE vr.user_id = ? AND c.user_id = ? AND vr.message_id IN (${placeholders})
    `, [ userId, userId, ...messageIds ]);
    return (result.rows as unknown as Row[]).map(row => this.toRecording(row));
  }

  async claimTranscription(
    userId: string, recordingId: string, durationMs: number,
    updatedAt: Date, staleBefore: Date,
  ) {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      UPDATE voice_recordings SET status = 'submitting', duration_ms = ?,
        provider_task_id = NULL, error_code = NULL, updated_at = ?
      WHERE id = ? AND user_id = ?
        AND (status IN ('uploading', 'failed') OR (status = 'submitting' AND updated_at <= ?))
        AND expires_at > ? AND deleted_at IS NULL
    `, [ durationMs, updatedAt, recordingId, userId, staleBefore, updatedAt ]);
    const recording = await this.findRecording(userId, recordingId);
    if (!recording) throw new Error('recording not found while claiming transcription');
    return { claimed: Number(result.affectedRows ?? 0) === 1, recording };
  }

  async markTranscriptionSubmitted(
    userId: string, recordingId: string, taskId: string, durationMs: number, updatedAt: Date,
  ): Promise<VoiceRecordingRecord> {
    const realm = await this.databaseService.getRealm();
    await realm.query(`
      UPDATE voice_recordings SET provider_task_id = COALESCE(provider_task_id, ?),
        duration_ms = COALESCE(duration_ms, ?), status = 'processing', updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'submitting'
    `, [ taskId, durationMs, updatedAt, recordingId, userId ]);
    return this.requireRecording(userId, recordingId);
  }

  async completeTranscription(
    userId: string, recordingId: string, transcript: string,
    durationMs: number | undefined, updatedAt: Date,
  ): Promise<VoiceRecordingRecord> {
    const realm = await this.databaseService.getRealm();
    await realm.query(`
      UPDATE voice_recordings SET transcript = ?, duration_ms = COALESCE(?, duration_ms),
        status = 'completed', error_code = NULL, updated_at = ?
      WHERE id = ? AND user_id = ? AND status IN ('submitting', 'processing')
    `, [ transcript, durationMs ?? null, updatedAt, recordingId, userId ]);
    return this.requireRecording(userId, recordingId);
  }

  async failTranscription(
    userId: string, recordingId: string, errorCode: string, updatedAt: Date,
  ): Promise<VoiceRecordingRecord> {
    const realm = await this.databaseService.getRealm();
    await realm.query(`
      UPDATE voice_recordings SET status = 'failed', error_code = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status IN ('submitting', 'processing')
    `, [ errorCode, updatedAt, recordingId, userId ]);
    return this.requireRecording(userId, recordingId);
  }

  async failStaleSubmission(
    userId: string,
    recordingId: string,
    staleBefore: Date,
    errorCode: string,
    updatedAt: Date,
  ): Promise<VoiceRecordingRecord> {
    const realm = await this.databaseService.getRealm();
    await realm.query(`
      UPDATE voice_recordings SET status = 'failed', error_code = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'submitting' AND updated_at <= ?
    `, [ errorCode, updatedAt, recordingId, userId, staleBefore ]);
    return this.requireRecording(userId, recordingId);
  }

  async findRecordingForUpdate(
    transaction: SpeechTransaction,
    userId: string,
    recordingId: string,
  ): Promise<VoiceRecordingRecord | null> {
    const rows = await this.query<Row[]>(transaction as Connection, `
      SELECT * FROM voice_recordings
      WHERE id = ? AND user_id = ?
      FOR UPDATE
    `, [ recordingId, userId ]);
    return rows[0] ? this.toRecording(rows[0]) : null;
  }

  async bindRecordingToMessage(
    transaction: SpeechTransaction,
    recordingId: string,
    messageId: string,
    updatedAt: Date,
  ): Promise<boolean> {
    try {
      const result = await this.query<{ affectedRows?: number }>(transaction as Connection, `
        UPDATE voice_recordings
        SET message_id = ?, updated_at = ?
        WHERE id = ? AND message_id IS NULL
      `, [ messageId, updatedAt, recordingId ]);
      return Number(result.affectedRows ?? 0) === 1;
    } catch (error) {
      if (this.isDuplicate(error)) return false;
      throw error;
    }
  }

  async findExpiredRecordings(now: Date, limit: number): Promise<VoiceRecordingRecord[]> {
    const realm = await this.databaseService.getRealm();
    const result = await realm.query(`
      SELECT * FROM voice_recordings
      WHERE expires_at <= ? AND deleted_at IS NULL
      ORDER BY expires_at ASC
      LIMIT ?
    `, [ now, limit ]);
    return (result.rows as unknown as Row[]).map(row => this.toRecording(row));
  }

  async markRecordingExpired(recordingId: string, updatedAt: Date): Promise<void> {
    const realm = await this.databaseService.getRealm();
    await realm.query(`
      UPDATE voice_recordings SET status = 'expired', deleted_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `, [ updatedAt, updatedAt, recordingId ]);
  }

  private async requireRecording(userId: string, recordingId: string) {
    const record = await this.findRecording(userId, recordingId);
    if (!record) throw new Error('recording not found after state transition');
    return record;
  }

  private recordingFromResult(result: { rows?: unknown }): VoiceRecordingRecord | null {
    const row = (result.rows as Row[] | undefined)?.[0];
    return row ? this.toRecording(row) : null;
  }

  private toRecording(row: Row): VoiceRecordingRecord {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      ...(row.message_id ? { messageId: String(row.message_id) } : {}),
      objectKey: String(row.oss_key),
      contentType: String(row.content_type) as VoiceContentType,
      sizeBytes: Number(row.size_bytes),
      ...(row.duration_ms !== null ? { durationMs: Number(row.duration_ms) } : {}),
      status: row.status as VoiceRecordingRecord['status'],
      ...(row.provider_task_id ? { providerTaskId: String(row.provider_task_id) } : {}),
      ...(row.transcript ? { transcript: String(row.transcript) } : {}),
      ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
      expiresAt: toDate(row.expires_at),
      ...(row.deleted_at ? { deletedAt: toDate(row.deleted_at) } : {}),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  private isDuplicate(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
      && error.code === 'ER_DUP_ENTRY';
  }

  private query<T>(connection: Connection, sql: string, values: QueryValue[]): Promise<T> {
    return new Promise((resolve, reject) => connection.query(sql, values, (error, result) => {
      if (error) reject(error); else resolve(result as T);
    }));
  }
}
