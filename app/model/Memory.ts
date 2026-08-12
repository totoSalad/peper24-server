import { Bone } from 'leoric';

export default class Memory extends Bone {
  declare id: string;
  declare userId: string;
  declare type: string;
  declare content: string;
  declare summary: string;
  declare normalizedKey: string;
  declare confidence: number;
  declare admissionScore: number;
  declare explicitlyRequested: boolean;
  declare admissionReason: string;
  declare assessmentJson: string;
  declare status: string;
  declare expiresAt?: Date;
  declare deletedAt?: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}
