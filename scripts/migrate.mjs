import { fileURLToPath } from 'node:url';
import Realm from 'leoric';

const realm = new Realm({
  client: 'mysql2',
  host: process.env.MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? 'peper24',
  password: process.env.MYSQL_PASSWORD ?? 'peper24_dev',
  database: process.env.MYSQL_DATABASE ?? 'peper24',
  models: [],
  migrations: fileURLToPath(new URL('../database/migrations', import.meta.url)),
});

try {
  await realm.connect();
  await realm.migrate();
} finally {
  // Leoric 2's MySQL driver inherits a no-op disconnect implementation.
  // Close the mysql2 pool explicitly so this one-shot command can exit.
  const pool = realm.driver?.pool;
  if (pool?.end) {
    await new Promise((resolve, reject) => {
      pool.end(error => error ? reject(error) : resolve());
    });
  } else {
    await realm.disconnect();
  }
}
