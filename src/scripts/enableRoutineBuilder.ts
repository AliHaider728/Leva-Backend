import { pool } from '../mysql-lib/db.js';
import { saveRoutineSettings } from '../mysql-lib/routineSettings.js';

async function main() {
  console.log('Ensuring routineBuilder is enabled in settings.featureFlags...');
  const [rows]: any = await pool.execute('SELECT id, featureFlags FROM settings LIMIT 1');
  if (rows[0]) {
    const flags = typeof rows[0].featureFlags === 'string' ? JSON.parse(rows[0].featureFlags) : (rows[0].featureFlags || {});
    flags.routineBuilder = true;
    await pool.execute('UPDATE settings SET featureFlags = ? WHERE id = ?', [JSON.stringify(flags), rows[0].id]);
    console.log('settings.featureFlags updated:', flags);
  }

  console.log('Ensuring routine_discount_settings table has 10% (2 items) and 20% (3 items) tiers...');
  await saveRoutineSettings({
    minimumDistinctProducts: 2,
    tiers: [
      { minProducts: 2, discountPercent: 10 },
      { minProducts: 3, discountPercent: 20 },
    ],
    quantityBonusEnabled: false,
    quantityBonusPercent: 0,
  });
  console.log('routine_discount_settings saved successfully.');
  await pool.end();
}

main().catch(err => {
  console.error('Error enabling routine builder:', err);
  process.exit(1);
});
