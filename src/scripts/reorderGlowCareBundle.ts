import { pool } from '../mysql-lib/db.js';

async function main() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows]: any = await conn.execute('SELECT id, name, displayOrder FROM bundles ORDER BY displayOrder ASC FOR UPDATE');
    const matches = rows.filter((b: any) => b.name.trim().toLowerCase() === 'alvora glow & care bundle');
    if (matches.length !== 1 || rows.length < 3) throw new Error('Expected exactly one Glow & Care bundle and at least three bundles. No ordering changed.');
    console.log('Before:', JSON.stringify(rows));
    const ordered = rows.filter((b: any) => b.id !== matches[0].id);
    ordered.splice(2, 0, matches[0]);
    for (let i = 0; i < ordered.length; i++) await conn.execute('UPDATE bundles SET displayOrder = ? WHERE id = ?', [i, ordered[i].id]);
    const [after]: any = await conn.execute('SELECT id, name, displayOrder FROM bundles ORDER BY displayOrder ASC');
    if (after[2].id !== matches[0].id || after.some((b: any, i: number) => Number(b.displayOrder) !== i)) throw new Error('Order verification failed.');
    await conn.commit();
    console.log('After:', JSON.stringify(after));
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
