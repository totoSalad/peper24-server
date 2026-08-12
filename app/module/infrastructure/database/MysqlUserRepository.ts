import { AccessLevel, Inject, SingletonProto } from '@eggjs/tegg';
import User from '../../../model/User';
import UserProfile from '../../../model/UserProfile';
import type {
  AccountProfile,
  AccountRecord,
  CreateAccountInput,
} from '../../account/service/AccountPorts';
import { UserRepository } from '../../account/service/AccountPorts';
import { AppError } from '../../system/error/AppError';
import { DatabaseService } from './DatabaseService';

@SingletonProto({ name: 'UserRepository', accessLevel: AccessLevel.PUBLIC })
export class MysqlUserRepository extends UserRepository {
  @Inject()
  private databaseService: DatabaseService;

  async findByEmail(email: string): Promise<AccountRecord | null> {
    await this.databaseService.getRealm();
    const user = await User.findOne({ email });
    return user ? this.toRecord(user) : null;
  }

  async findById(id: string): Promise<AccountRecord | null> {
    await this.databaseService.getRealm();
    const user = await User.findOne({ id });
    return user ? this.toRecord(user) : null;
  }

  async create(input: CreateAccountInput): Promise<AccountRecord> {
    const realm = await this.databaseService.getRealm();
    await realm.transaction(async ({ connection }) => {
      await User.create(
        {
          id: input.id,
          email: input.email,
          passwordHash: input.passwordHash,
          status: input.status,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        },
        { connection },
      );
      await UserProfile.create(
        {
          userId: input.id,
          ...input.profile,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        },
        { connection },
      );
    });
    const created = await this.findById(input.id);
    if (!created) throw new AppError('ACCOUNT_PERSISTENCE_FAILED', '账号保存失败', 500);
    return created;
  }

  async updateProfile(
    userId: string,
    profile: AccountProfile,
    updatedAt: Date,
  ): Promise<AccountRecord> {
    await this.databaseService.getRealm();
    await UserProfile.update(
      { userId },
      { ...profile, age: profile.age ?? null, occupation: profile.occupation ?? null, updatedAt },
    );
    await User.update({ id: userId }, { updatedAt });
    const updated = await this.findById(userId);
    if (!updated) throw new AppError('ACCOUNT_NOT_FOUND', '账号不存在', 404);
    return updated;
  }

  private async toRecord(user: User): Promise<AccountRecord> {
    const profile = await UserProfile.findOne({ userId: user.id });
    if (!profile) throw new AppError('PROFILE_NOT_FOUND', '用户资料不存在', 500);
    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      status: user.status,
      profile: {
        displayName: profile.displayName,
        age: profile.age ?? undefined,
        occupation: profile.occupation ?? undefined,
        englishLevel: profile.englishLevel,
      },
      createdAt: new Date(user.createdAt),
      updatedAt: new Date(user.updatedAt),
    };
  }
}
