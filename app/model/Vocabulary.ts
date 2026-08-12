import { Bone } from 'leoric';

export default class Vocabulary extends Bone {
  declare id: string;
  declare userId: string;
  declare originalExpression: string;
  declare expression: string;
  declare normalizedExpression: string;
  declare detail: string;
  declare lastEncounteredAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}
