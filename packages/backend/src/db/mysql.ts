import mysql from 'mysql2/promise';

const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = Number(process.env.DB_PORT ?? 3306);
const DB_USER = process.env.DB_USER ?? 'mbillingUser';
const DB_PASS = process.env.DB_PASS ?? '';
const DB_NAME = process.env.DB_NAME ?? 'mbilling';

let pool: mysql.Pool | null = null;

export async function initDatabase(): Promise<void> {
  pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
  });

  // Test connection
  const conn = await pool.getConnection();
  conn.release();
}

/**
 * Execute a parameterized SQL query.
 * Always use ? placeholders — never interpolate user input.
 */
export async function dbQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  if (!pool) throw new Error('Database not initialized');

  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

/**
 * Execute a parameterized INSERT/UPDATE/DELETE.
 */
export async function dbExecute(
  sql: string,
  params: unknown[] = []
): Promise<{ affectedRows: number; insertId: number }> {
  if (!pool) throw new Error('Database not initialized');

  const [result] = await pool.execute(sql, params) as [mysql.ResultSetHeader, any];
  return { affectedRows: result.affectedRows, insertId: result.insertId };
}

export function getPool(): mysql.Pool {
  if (!pool) throw new Error('Database not initialized');
  return pool;
}
