import type {
  AccountRecord,
  CreateAccountInput,
  PasswordHasher,
  SessionStore,
  UserRepository,
} from '../../../app/module/account/service/AccountPorts';
import type { Clock, IdGenerator } from '../../../app/module/system/service/SystemPorts';

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, AccountRecord>();

  async findByEmail(email: string): Promise<AccountRecord | null> {
    return [ ...this.users.values() ].find(user => user.email === email) ?? null;
  }

  async findById(id: string): Promise<AccountRecord | null> {
    return this.users.get(id) ?? null;
  }

  async create(input: CreateAccountInput): Promise<AccountRecord> {
    const record: AccountRecord = { ...input };
    this.users.set(record.id, record);
    return record;
  }

  async updateProfile(
    userId: string,
    profile: AccountRecord['profile'],
    updatedAt: Date,
  ): Promise<AccountRecord> {
    const current = this.users.get(userId);
    if (!current) throw new Error('user not found');
    const updated = { ...current, profile: { ...profile }, updatedAt };
    this.users.set(userId, updated);
    return updated;
  }
}

export class FakePasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return `hashed:${password}`;
  }

  async verify(hash: string, password: string): Promise<boolean> {
    return hash === `hashed:${password}`;
  }
}

export class FakeSessionStore implements SessionStore {
  readonly sessions = new Map<string, string>();

  async create(sessionId: string, userId: string): Promise<void> {
    this.sessions.set(sessionId, userId);
  }

  async findUserId(sessionId: string): Promise<string | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

export class FixedIdGenerator implements IdGenerator {
  private index = 0;

  constructor(private readonly ids: string[]) {}

  next(): string {
    const id = this.ids[this.index];
    this.index += 1;
    if (!id) throw new Error('No fixed ID available');
    return id;
  }
}

export class FakeClock implements Clock {
  constructor(private readonly current: Date) {}

  now(): Date {
    return new Date(this.current);
  }
}
