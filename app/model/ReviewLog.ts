import { Bone } from 'leoric';
import type { ReviewResult } from '../module/vocabulary/service/VocabularyPorts';

export default class ReviewLog extends Bone {
  declare id: string;
  declare userId: string;
  declare vocabularyId: string;
  declare clientRequestId: string;
  declare result: ReviewResult;
  declare score: number;
  declare beforeStateJson: string;
  declare afterStateJson: string;
  declare reviewedAt: Date;
}
