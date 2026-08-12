import type { ReviewStateRecord } from './VocabularyPorts';

const dayMs = 24 * 60 * 60 * 1000;

export function scheduleReview(
  current: ReviewStateRecord,
  score: number,
  reviewedAt: Date,
): ReviewStateRecord {
  let repetitions = current.repetitions;
  let intervalDays = current.intervalDays;
  if (score < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(current.intervalDays * current.easinessFactor));
  }
  const easinessFactor = Math.max(
    1.3,
    current.easinessFactor + (0.1 - (5 - score) * (0.08 + (5 - score) * 0.02)),
  );
  return {
    vocabularyId: current.vocabularyId,
    repetitions,
    intervalDays,
    easinessFactor: Number(easinessFactor.toFixed(4)),
    nextReviewAt: new Date(reviewedAt.getTime() + intervalDays * dayMs),
    updatedAt: reviewedAt,
  };
}
