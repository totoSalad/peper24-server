import { Bone } from 'leoric';

export default class GrammarErrorOccurrence extends Bone {
  static table = 'grammar_error_occurrences';

  declare id: string;
  declare patternId: string;
  declare userMessageId: string;
  declare detailsJson: string;
  declare createdAt: Date;
}
