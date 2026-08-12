import type {
  ReviewOutcome,
  ReviewStateRecord,
  SaveVocabularyInput,
  SourceMessage,
  VocabularyRecord,
  VocabularyRepository,
} from '../../../app/module/vocabulary/service/VocabularyPorts';
import { scheduleReview } from '../../../app/module/vocabulary/service/ReviewScheduler';

type ListedVocabulary = VocabularyRecord & { reviewState: ReviewStateRecord };

export class InMemoryVocabularyRepository implements VocabularyRepository {
  readonly sources = new Map<string, { userId: string; message: SourceMessage }>();
  readonly items: ListedVocabulary[] = [];
  readonly contexts: SaveVocabularyInput['context'][] = [];
  readonly reviews = new Map<string, ReviewOutcome>();

  async findSourceMessage(userId: string, messageId: string): Promise<SourceMessage | null> {
    const value = this.sources.get(messageId);
    return value?.userId === userId ? value.message : null;
  }

  async save(input: SaveVocabularyInput): Promise<VocabularyRecord> {
    let existing = this.items.find(item => item.userId === input.vocabulary.userId
      && item.normalizedExpression === input.vocabulary.normalizedExpression);
    if (!existing) {
      existing = {
        ...input.vocabulary,
        reviewState: { ...input.initialReviewState, vocabularyId: input.vocabulary.id },
      };
      this.items.push(existing);
    } else {
      existing.lastEncounteredAt = input.vocabulary.lastEncounteredAt;
      existing.updatedAt = input.vocabulary.updatedAt;
    }
    if (!this.contexts.some(context => context.vocabularyId === existing?.id
      && context.messageId === input.context.messageId)) {
      this.contexts.push({ ...input.context, vocabularyId: existing.id });
    }
    return existing;
  }

  async list(userId: string): Promise<ListedVocabulary[]> {
    return this.items.filter(item => item.userId === userId)
      .sort((a, b) => b.lastEncounteredAt.getTime() - a.lastEncounteredAt.getTime());
  }

  async delete(userId: string, vocabularyId: string): Promise<boolean> {
    const index = this.items.findIndex(item => item.userId === userId && item.id === vocabularyId);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  async listDue(userId: string, now: Date, limit: number): Promise<ListedVocabulary[]> {
    return this.items.filter(item => item.userId === userId
      && item.reviewState.nextReviewAt <= now)
      .sort((a, b) => a.reviewState.nextReviewAt.getTime() - b.reviewState.nextReviewAt.getTime())
      .slice(0, limit);
  }

  async recordReview(input: {
    id: string; userId: string; vocabularyId: string; clientRequestId: string;
    result: 'again' | 'hard' | 'good' | 'easy'; score: number; reviewedAt: Date;
  }): Promise<ReviewOutcome | null> {
    const replay = this.reviews.get(`${input.userId}:${input.clientRequestId}`);
    if (replay) return replay;
    const item = this.items.find(value => value.userId === input.userId
      && value.id === input.vocabularyId);
    if (!item) return null;
    item.reviewState = scheduleReview(item.reviewState, input.score, input.reviewedAt);
    const outcome = {
      ...item.reviewState,
      result: input.result,
      score: input.score,
      reviewedAt: input.reviewedAt,
    };
    this.reviews.set(`${input.userId}:${input.clientRequestId}`, outcome);
    return outcome;
  }
}
