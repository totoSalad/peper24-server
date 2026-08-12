import { Bone } from 'leoric';

export default class User extends Bone {
  declare id: string;
  declare email: string;
  declare passwordHash: string;
  declare status: 'active' | 'disabled';
  declare createdAt: Date;
  declare updatedAt: Date;
}
