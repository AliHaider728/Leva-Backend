import { pool } from './db.js';
import { DEFAULT_ROUTINE_DISCOUNT, validateRoutineSettings, type RoutineDiscountSettings } from '../lib/routineDiscount.js';

// A separate singleton avoids changing the legacy settings schema. Reads are
// backwards compatible; the first admin save creates the table if necessary.
export async function getRoutineSettings(db: Pick<typeof pool, 'execute'> = pool): Promise<RoutineDiscountSettings> {
  try {
    const [rows] = await db.execute('SELECT config FROM routine_discount_settings WHERE id = 1');
    const row = (rows as any[])[0];
    return row ? validateRoutineSettings(typeof row.config === 'string' ? JSON.parse(row.config) : row.config) : validateRoutineSettings(DEFAULT_ROUTINE_DISCOUNT);
  } catch (error: any) {
    if (error.code === 'ER_NO_SUCH_TABLE') return validateRoutineSettings(DEFAULT_ROUTINE_DISCOUNT);
    throw error;
  }
}

export async function saveRoutineSettings(input: unknown) {
  const settings = validateRoutineSettings(input);
  await pool.execute(`CREATE TABLE IF NOT EXISTS routine_discount_settings (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    config JSON NOT NULL,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  await pool.execute('INSERT INTO routine_discount_settings (id, config) VALUES (1, ?) ON DUPLICATE KEY UPDATE config = VALUES(config)', [JSON.stringify(settings)]);
  return settings;
}
