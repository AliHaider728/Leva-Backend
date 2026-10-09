import { pool } from '../mysql-lib/db.js';

async function main() { try {
  const [columns]: any = await pool.execute("SHOW COLUMNS FROM order_items LIKE 'routineComponents'");
  if (!columns.length) await pool.execute('ALTER TABLE order_items ADD COLUMN routineComponents JSON NULL');
  console.log('Routine order component storage ready. Existing orders unchanged.');
} finally { await pool.end(); } }
main().catch(error => { console.error(error.message); process.exitCode = 1; });
