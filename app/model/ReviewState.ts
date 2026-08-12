import { Bone } from 'leoric';

export default class ReviewState extends Bone {
  declare vocabularyId: string;
  declare repetitions: number;
  declare intervalDays: number;
  declare easinessFactor: number;
  declare nextReviewAt: Date;
  declare updatedAt: Date;
}
