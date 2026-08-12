export const englishLevels = [ 'A1', 'A2', 'B1', 'B2', 'C1', 'C2' ] as const;
export type EnglishLevel = typeof englishLevels[number];

export interface AccountProfile {
  displayName: string;
  age?: number;
  occupation?: string;
  englishLevel: EnglishLevel;
}

export interface AccountRecord {
  id: string;
  email: string;
  passwordHash: string;
  status: 'active' | 'disabled';
  profile: AccountProfile;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateAccountInput = AccountRecord;

export abstract class UserRepository {
  abstract findByEmail(email: string): Promise<AccountRecord | null>;
  abstract findById(id: string): Promise<AccountRecord | null>;
  abstract create(input: CreateAccountInput): Promise<AccountRecord>;
  abstract updateProfile(
    userId: string,
    profile: AccountProfile,
    updatedAt: Date,
  ): Promise<AccountRecord>;
}

export abstract class PasswordHasher {
  abstract hash(password: string): Promise<string>;
  abstract verify(hash: string, password: string): Promise<boolean>;
}

export abstract class SessionStore {
  abstract create(sessionId: string, userId: string): Promise<void>;
  abstract findUserId(sessionId: string): Promise<string | null>;
  abstract delete(sessionId: string): Promise<void>;
}
