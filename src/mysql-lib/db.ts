import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';




dotenv.config();

const MYSQL_CONFIG: mysql.PoolOptions = {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
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
