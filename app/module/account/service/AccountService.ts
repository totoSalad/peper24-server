import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import { AppError } from '../../system/error/AppError';
import { Clock, IdGenerator } from '../../system/service/SystemPorts';
import {
  AccountProfile,
  AccountRecord,
  englishLevels,
  PasswordHasher,
  SessionStore,
  UserRepository,
} from './AccountPorts';

export interface PublicAccount {
  id: string;
  email: string;
  status: AccountRecord['status'];
  profile: AccountProfile;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterAccountInput {
  email: string;
  password: string;
  profile: AccountProfile;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthenticatedAccount {
  sessionId: string;
  user: PublicAccount;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

function assertProfile(profile: AccountProfile): void {
  if (!profile.displayName.trim()) {
    throw new AppError('INVALID_PROFILE', '昵称不能为空');
  }
  if (!englishLevels.includes(profile.englishLevel)) {
    throw new AppError('INVALID_ENGLISH_LEVEL', '英语水平必须是 A1 到 C2');
  }
  if (profile.age !== undefined && (profile.age < 8 || profile.age > 100)) {
    throw new AppError('INVALID_PROFILE', '年龄必须在 8 到 100 之间');
  }
}

function toPublicAccount(account: AccountRecord): PublicAccount {
  return {
    id: account.id,
    email: account.email,
    status: account.status,
    profile: { ...account.profile },
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

@SingletonProto({ accessLevel: AccessLevel.PUBLIC })
export class AccountService {
  constructor(
    @Inject('UserRepository') private readonly users: UserRepository,
    @Inject('PasswordHasher') private readonly passwordHasher: PasswordHasher,
    @Inject('SessionStore') private readonly sessions: SessionStore,
    @Inject('IdGenerator') private readonly ids: IdGenerator,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async register(input: RegisterAccountInput): Promise<AuthenticatedAccount> {
    const email = normalizeEmail(input.email);
    assertProfile(input.profile);
    if (input.password.length < 8) {
      throw new AppError('INVALID_PASSWORD', '密码至少需要 8 位');
    }
    if (await this.users.findByEmail(email)) {
      throw new AppError('EMAIL_ALREADY_REGISTERED', '该邮箱已经注册', 409);
    }

    const now = this.clock.now();
    const account = await this.users.create({
      id: this.ids.next(),
      email,
      passwordHash: await this.passwordHasher.hash(input.password),
      status: 'active',
      profile: {
        ...input.profile,
        displayName: input.profile.displayName.trim(),
        occupation: input.profile.occupation?.trim() || undefined,
      },
      createdAt: now,
      updatedAt: now,
    });
    return this.createAuthenticatedAccount(account);
  }

  async login(input: LoginInput): Promise<AuthenticatedAccount> {
    const account = await this.users.findByEmail(normalizeEmail(input.email));
    if (
      !account ||
      account.status !== 'active' ||
      !(await this.passwordHasher.verify(account.passwordHash, input.password))
    ) {
      throw new AppError('INVALID_CREDENTIALS', '邮箱或密码不正确', 401);
    }
    return this.createAuthenticatedAccount(account);
  }

  async logout(sessionId: string): Promise<void> {
    if (sessionId) await this.sessions.delete(sessionId);
  }

  async getCurrentUser(sessionId: string): Promise<PublicAccount> {
    const userId = sessionId ? await this.sessions.findUserId(sessionId) : null;
    if (!userId) throw new AppError('UNAUTHENTICATED', '请先登录', 401);
    const account = await this.users.findById(userId);
    if (!account || account.status !== 'active') {
      throw new AppError('UNAUTHENTICATED', '登录状态已经失效', 401);
    }
    return toPublicAccount(account);
  }

  async updateProfile(sessionId: string, profile: AccountProfile): Promise<PublicAccount> {
    assertProfile(profile);
    const current = await this.getCurrentUser(sessionId);
    const updated = await this.users.updateProfile(
      current.id,
      {
        ...profile,
        displayName: profile.displayName.trim(),
        occupation: profile.occupation?.trim() || undefined,
      },
      this.clock.now(),
    );
    return toPublicAccount(updated);
  }

  private async createAuthenticatedAccount(account: AccountRecord): Promise<AuthenticatedAccount> {
    const sessionId = this.ids.next();
    await this.sessions.create(sessionId, account.id);
    return { sessionId, user: toPublicAccount(account) };
  }
}
