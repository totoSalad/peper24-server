/** 词汇富化值对象（DB 只留这一个字段，不拆多列）。 */
export interface VocabularyDetail {
  cnMeaning: string;
  enMeaning: string;
  example: string;
  phonetic: string;
}

export interface VocabularyInfo {
  expression: string;
  normalizedExpression: string;
  detail: VocabularyDetail;
}

export interface VocabularyRecord extends VocabularyInfo {
  id: string;
  userId: string;
  originalExpression: string;
  lastEncounteredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface VocabularyContextRecord {
  id: string;
  vocabularyId: string;
  messageId: string;
  sentence: string;
  createdAt: Date;
}

export interface SourceMessage {
  id: string;
  content: string;
}

export interface ReviewStateRecord {
  vocabularyId: string;
  repetitions: number;
  intervalDays: number;
  easinessFactor: number;
  nextReviewAt: Date;
  updatedAt: Date;
}

export type ReviewResult = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewOutcome extends ReviewStateRecord {
  result: ReviewResult;
  score: number;
  reviewedAt: Date;
}

export interface SaveVocabularyInput {
  vocabulary: VocabularyRecord;
  context: VocabularyContextRecord;
  initialReviewState: ReviewStateRecord;
}

export abstract class VocabularyRepository {
  abstract findSourceMessage(userId: string, messageId: string): Promise<SourceMessage | null>;
  abstract save(input: SaveVocabularyInput): Promise<VocabularyRecord>;
  abstract list(userId: string): Promise<Array<VocabularyRecord & { reviewState: ReviewStateRecord }>>;
  abstract delete(userId: string, vocabularyId: string): Promise<boolean>;
  abstract listDue(
    userId: string,
    now: Date,
    limit: number,
  ): Promise<Array<VocabularyRecord & { reviewState: ReviewStateRecord }>>;
  abstract recordReview(input: {
    id: string;
    userId: string;
    vocabularyId: string;
    clientRequestId: string;
    result: ReviewResult;
    score: number;
    reviewedAt: Date;
  }): Promise<ReviewOutcome | null>;
}
