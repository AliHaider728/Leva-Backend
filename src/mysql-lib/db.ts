import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const clean = (val?: string) => {
  if (!val) return undefined;
  return val.trim().replace(/^['"]|['"]$/g, '').trim();
};

const MYSQL_CONFIG: mysql.PoolOptions = {
  host: clean(process.env.DB_HOST || process.env.LEVA_MYSQL_HOST),
  port: Number(clean(process.env.DB_PORT || process.env.LEVA_MYSQL_PORT) || 3306),
  user: clean(process.env.DB_USER || process.env.LEVA_MYSQL_USER),
  password: clean(process.env.DB_PASSWORD || process.env.LEVA_MYSQL_PASSWORD),
  database: clean(process.env.DB_NAME || process.env.LEVA_MYSQL_DATABASE),
  connectTimeout: 10000,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  typeCast: function (field: any, next: any) {
    if (field.type === 'TINY' && field.length === 1) {
      return (field.string() === '1');
    }
    return next();
  }
};

// Create a connection pool instead of a single connection for the web server
export const pool = mysql.createPool(MYSQL_CONFIG);

export default pool;
