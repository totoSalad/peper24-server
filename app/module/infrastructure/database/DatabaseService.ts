import { AccessLevel, SingletonProto } from '@eggjs/tegg';
import Realm from 'leoric';
import User from '../../../model/User';
import UserProfile from '../../../model/UserProfile';
import Conversation from '../../../model/Conversation';
import Message from '../../../model/Message';
import AIUsageLog from '../../../model/AIUsageLog';
import GrammarErrorOccurrence from '../../../model/GrammarErrorOccurrence';
import GrammarErrorPattern from '../../../model/GrammarErrorPattern';
import Memory from '../../../model/Memory';

@SingletonProto({ accessLevel: AccessLevel.PUBLIC })
export class DatabaseService {
  private realm?: Realm;
  private connecting?: Promise<Realm>;

  async getRealm(): Promise<Realm> {
    if (this.realm?.connected) return this.realm;
    if (!this.connecting) {
      const realm = new Realm({
        client: 'mysql2',
        host: process.env.MYSQL_HOST ?? '127.0.0.1',
        port: Number(process.env.MYSQL_PORT ?? 3306),
        user: process.env.MYSQL_USER ?? 'peper24',
        password: process.env.MYSQL_PASSWORD ?? 'peper24_dev',
        database: process.env.MYSQL_DATABASE ?? 'peper24',
        models: [
          User,
          UserProfile,
          Conversation,
          Message,
          AIUsageLog,
          GrammarErrorPattern,
          GrammarErrorOccurrence,
          Memory,
        ],
      });
      this.connecting = realm.connect().then(() => {
        this.realm = realm;
        return realm;
      });
    }
    return this.connecting;
  }
}
