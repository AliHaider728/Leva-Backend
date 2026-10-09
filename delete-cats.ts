import { pool } from './src/mysql-lib/db.js';
async function run() {
  await pool.execute('DELETE FROM product_categories');
  await pool.execute('DELETE FROM categories');
  console.log('Categories deleted');
  process.exit(0);
}
run();
