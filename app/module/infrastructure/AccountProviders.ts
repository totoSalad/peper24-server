import { argon2id, hash, verify } from 'argon2';
import { AccessLevel, SingletonProto } from '@eggjs/tegg';
import { ulid } from 'ulid';
import { Clock, IdGenerator } from '../system/service/SystemPorts';
import {
  PasswordHasher,
} from '../account/service/AccountPorts';

@SingletonProto({ name: 'PasswordHasher', accessLevel: AccessLevel.PUBLIC })
export class Argon2PasswordHasher extends PasswordHasher {
  async hash(password: string): Promise<string> {
    return hash(password, { type: argon2id });
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password);
  }
}

@SingletonProto({ name: 'IdGenerator', accessLevel: AccessLevel.PUBLIC })
export class UlidGenerator extends IdGenerator {
  next(): string {
    return ulid();
  }
}

@SingletonProto({ name: 'Clock', accessLevel: AccessLevel.PUBLIC })
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
