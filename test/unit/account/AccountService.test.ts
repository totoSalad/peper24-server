import { strict as assert } from 'node:assert';
import { AccountService } from '../../../app/module/account/service/AccountService';
import { AppError } from '../../../app/module/system/error/AppError';
import {
  FakeClock,
  FakePasswordHasher,
  FakeSessionStore,
  FixedIdGenerator,
  InMemoryUserRepository,
} from '../../support/fake/AccountFakes';

describe('AccountService', () => {
  const now = new Date('2026-08-06T00:00:00.000Z');

  function setup() {
    const users = new InMemoryUserRepository();
    const sessions = new FakeSessionStore();
    const service = new AccountService(
      users,
      new FakePasswordHasher(),
      sessions,
      new FixedIdGenerator([ '01USER', '01SESSION', '01SESSION2' ]),
      new FakeClock(now),
    );
    return { service, users, sessions };
  }

  it('registers an account, normalizes email and creates a session', async () => {
    const { service, users, sessions } = setup();

    const result = await service.register({
      email: ' LiHua@Example.COM ',
      password: 'demo1234',
      profile: {
        displayName: 'Li Hua',
        age: 28,
        occupation: '软件工程师',
        englishLevel: 'B1',
      },
    });

    assert.equal(result.sessionId, '01SESSION');
    assert.equal(result.user.email, 'lihua@example.com');
    assert.equal(result.user.profile.englishLevel, 'B1');
    assert.equal('passwordHash' in result.user, false);
    assert.equal((await users.findByEmail('lihua@example.com'))?.passwordHash, 'hashed:demo1234');
    assert.equal(await sessions.findUserId('01SESSION'), '01USER');
  });

  it('rejects duplicate email registration', async () => {
    const { service } = setup();
    const input = {
      email: 'lihua@example.com',
      password: 'demo1234',
      profile: { displayName: 'Li Hua', englishLevel: 'B1' as const },
    };
    await service.register(input);

    await assert.rejects(
      service.register(input),
      (error: unknown) => error instanceof AppError && error.code === 'EMAIL_ALREADY_REGISTERED',
    );
  });

  it('logs in with a valid password and rejects an invalid password', async () => {
    const { service } = setup();
    await service.register({
      email: 'lihua@example.com',
      password: 'demo1234',
      profile: { displayName: 'Li Hua', englishLevel: 'B1' },
    });

    const login = await service.login({ email: 'LIHUA@example.com', password: 'demo1234' });
    assert.equal(login.sessionId, '01SESSION2');

    await assert.rejects(
      service.login({ email: 'lihua@example.com', password: 'wrong-password' }),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_CREDENTIALS',
    );
  });

  it('loads and updates the current profile through a session', async () => {
    const { service } = setup();
    const registered = await service.register({
      email: 'lihua@example.com',
      password: 'demo1234',
      profile: { displayName: 'Li Hua', englishLevel: 'B1' },
    });

    const updated = await service.updateProfile(registered.sessionId, {
      displayName: '小李',
      age: 29,
      occupation: '产品经理',
      englishLevel: 'B2',
    });

    assert.equal(updated.profile.displayName, '小李');
    assert.equal(updated.profile.englishLevel, 'B2');
    assert.equal((await service.getCurrentUser(registered.sessionId)).id, registered.user.id);
  });

  it('invalidates the session on logout', async () => {
    const { service } = setup();
    const registered = await service.register({
      email: 'lihua@example.com',
      password: 'demo1234',
      profile: { displayName: 'Li Hua', englishLevel: 'B1' },
    });

    await service.logout(registered.sessionId);

    await assert.rejects(
      service.getCurrentUser(registered.sessionId),
      (error: unknown) => error instanceof AppError && error.code === 'UNAUTHENTICATED',
    );
  });
});
