import { pool } from '../mysql-lib/db.js';
export const featureDefaults = { categories: false, variants: false, bundles: true, routineBuilder: false, coupons: true, reviews: true, audioReviews: false, wishlist: true, contact: true, tracking: false };
export type FeatureFlag = keyof typeof featureDefaults;
export type Features = Record<FeatureFlag, boolean>;
export function environmentFeatures(): Features { return Object.fromEntries(Object.entries(featureDefaults).map(([flag, fallback]) => { const value = process.env['FEATURE_' + flag.replace(/[A-Z]/g, letter => '_' + letter).toUpperCase()]?.trim().toLowerCase(); return [flag, value ? ['true', '1', 'on'].includes(value) : fallback]; })) as Features; }
export function mergeFeatures(stored: unknown): Features { const defaults = environmentFeatures(); const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored; if (parsed && typeof parsed === 'object')
    for (const flag of Object.keys(defaults) as FeatureFlag[]) {
        const value = (parsed as Record<string, unknown>)[flag];
        if (typeof value === 'boolean')
            defaults[flag] = value;
    } return defaults; }
export async function getFeatures(connection: any = pool): Promise<Features> { try {
    const [rows] = await connection.execute('SELECT featureFlags FROM settings LIMIT 1');
    return mergeFeatures(rows[0]?.featureFlags);
}
catch (error: any) {
    if (error.code === 'ER_BAD_FIELD_ERROR')
        return environmentFeatures();
    throw error;
} }
