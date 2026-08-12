import { execFileSync } from 'node:child_process';
import mysql from 'mysql2/promise';

const database = 'peper24_test';
const applicationUser = process.env.MYSQL_USER ?? 'peper24';
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_ROOT_USER ?? 'root',
  password: process.env.MYSQL_ROOT_PASSWORD ?? 'peper24_root_dev',
});

try {
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );
  await connection.query(
    `GRANT ALL PRIVILEGES ON ${database}.* TO ${connection.escape(applicationUser)}@'%'`,
  );
} finally {
  await connection.end();
}

execFileSync(process.execPath, [ 'scripts/migrate.mjs' ], {
  cwd: process.cwd(),
  env: { ...process.env, MYSQL_DATABASE: database },
  stdio: 'inherit',
});
