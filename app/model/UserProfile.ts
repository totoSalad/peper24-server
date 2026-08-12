import { Bone } from 'leoric';
import type { EnglishLevel } from '../module/account/service/AccountPorts';

export default class UserProfile extends Bone {
  declare userId: string;
  declare displayName: string;
  declare age?: number;
  declare occupation?: string;
  declare englishLevel: EnglishLevel;
  declare createdAt: Date;
  declare updatedAt: Date;
}
