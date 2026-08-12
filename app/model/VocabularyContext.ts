import { Bone } from 'leoric';

export default class VocabularyContext extends Bone {
  declare id: string;
  declare vocabularyId: string;
  declare messageId: string;
  declare sentence: string;
  declare createdAt: Date;
}
