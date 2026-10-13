/** Explicit deployment migration. Never run during build or server startup. */
import { pool } from '../mysql-lib/db.js';
async function main() {
    try {
        for (const [table, column, definition] of [['settings', 'adminFeatures', 'JSON NULL'], ['settings', 'featureFlags', 'JSON NULL'], ['users', 'resetPasswordAttempts', 'INT NOT NULL DEFAULT 0'], ['orders', 'checkoutRequestId', 'VARCHAR(120) NULL'], ['order_items', 'routineComponents', 'JSON NULL']]) {
            const [rows]: any = await pool.query('SHOW COLUMNS FROM ' + table + ' LIKE ?', [column]);
            if (!rows.length)
                await pool.execute('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition);
        }
        const [tokenColumns]: any = await pool.execute("SHOW COLUMNS FROM users LIKE 'resetPasswordToken'");
        const tokenType = String(tokenColumns[0]?.Type || '');
        const tokenWidth = Number(tokenType.match(/(?:var)?char\((\d+)\)/i)?.[1] || 0);
        if (tokenWidth && tokenWidth < 64)
            await pool.execute('ALTER TABLE users MODIFY COLUMN resetPasswordToken VARCHAR(64) NULL');
        const [duplicates]: any = await pool.execute('SELECT checkoutRequestId,COUNT(*) AS count FROM orders WHERE checkoutRequestId IS NOT NULL GROUP BY checkoutRequestId HAVING COUNT(*)>1');
        if (duplicates.length)
            throw new Error('Duplicate checkout request IDs exist. Resolve them before adding the unique constraint; no orders have been removed.');
        const [indexes]: any = await pool.execute('SHOW INDEX FROM orders');
        const groups = new Map<string, any[]>();
        for (const index of indexes)
            groups.set(index.Key_name, [...(groups.get(index.Key_name) || []), index]);
        const unique = [...groups.values()].some(rows => rows.length === 1 && rows[0].Column_name === 'checkoutRequestId' && rows[0].Non_unique === 0);
        if (!unique)
            await pool.execute('ALTER TABLE orders ADD UNIQUE KEY uq_orders_checkout_request (checkoutRequestId)');
        console.log('Feature flags, reset attempts and unique checkout IDs are ready.');
    }
    finally {
        await pool.end();
    }
}
main().catch((error: any) => { console.error('Migration error code: ' + (error.code || 'FAILED')); console.error('Migration did not finish. Inspect schema and duplicate checkout IDs before retrying.'); process.exitCode = 1; });
