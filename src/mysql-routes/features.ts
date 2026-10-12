import { Router } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../mysql-lib/db.js';
import { featureDefaults, getFeatures, mergeFeatures, type FeatureFlag } from '../config/features.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
const router = Router();
router.get('/', async (_req, res) => { try {
    res.set('Cache-Control', 'no-store');
    res.json(await getFeatures());
}
catch {
    res.status(503).json({ error: 'Feature settings are temporarily unavailable.' });
} });
router.put('/', authenticateToken, requireAdmin, async (req, res) => { const flags = req.body; if (!flags || typeof flags !== 'object' || Array.isArray(flags) || Object.keys(flags).some(key => !Object.hasOwn(featureDefaults, key) || typeof flags[key] !== 'boolean'))
    return res.status(400).json({ error: 'Provide known feature flags with boolean values.' }); let conn: any; try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT id, featureFlags FROM settings LIMIT 1 FOR UPDATE');
    const current = rows[0];
    const next = { ...mergeFeatures(current?.featureFlags), ...flags };
    if (current)
        await conn.execute('UPDATE settings SET featureFlags = ?,updatedAt=NOW() WHERE id=?', [JSON.stringify(next), current.id]);
    else
        await conn.execute('INSERT INTO settings (id,storeName,email,phone,address,currency,standardShippingFee,freeShippingThreshold,featureFlags,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW())', [randomUUID(), process.env.STORE_NAME || 'LEVA', process.env.SUPPORT_EMAIL || '', process.env.SUPPORT_PHONE || '', '', 'Rs.', 250, 5000, JSON.stringify(next)]);
    await conn.commit();
    res.json(next);
}
catch (error: any) {
    if (conn)
        await conn.rollback();
    res.status(503).json({ error: error.code === 'ER_BAD_FIELD_ERROR' ? 'Feature storage migration is required.' : 'Could not save feature settings.' });
}
finally {
    conn?.release();
} });
export default router;
