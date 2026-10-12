import mysql from 'mysql2/promise';
import dotenv from 'dotenv';





dotenv.config();

const MYSQL_CONFIG: mysql.PoolOptions = {
  host: (process.env.DB_HOST || process.env.LEVA_MYSQL_HOST),
  port: Number(process.env.DB_PORT || process.env.LEVA_MYSQL_PORT || 3306),
  user: (process.env.DB_USER || process.env.LEVA_MYSQL_USER),
  password: (process.env.DB_PASSWORD || process.env.LEVA_MYSQL_PASSWORD),
  database: (process.env.DB_NAME || process.env.LEVA_MYSQL_DATABASE),
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
