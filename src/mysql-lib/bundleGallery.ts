import { pool } from './db.js';
import { randomUUID } from 'crypto';

export function validateBundleGallery(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error('Bundle gallery must contain at most 8 images.');
  return value.map(image => {
    if (typeof image !== 'string' || !image.trim() || image.length > 2048) throw new Error('Each gallery image must have a valid URL.');
    const url = image.trim();
    if (!/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url)) throw new Error('Gallery images must use HTTP(S) or a local image path.');
    if (/^https?:/i.test(url)) {
      try { new URL(url); } catch { throw new Error('Each gallery image must have a valid URL.'); }
    }
    return url;
  });
}

// Matches product_images: independent image rows with explicit display positions.
// No product images are copied into bundle galleries during migration.
export async function ensureBundleGallerySchema() {
  await pool.execute(`CREATE TABLE IF NOT EXISTS bundle_images (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    bundle_id VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    position INT UNSIGNED NOT NULL,
    UNIQUE KEY bundle_image_position (bundle_id, position)
  )`);
}

export async function getBundleGalleries(ids: string[], db: any = pool): Promise<Map<string, string[]>> {
  const galleries = new Map<string, string[]>();
  if (!ids.length) return galleries;
  try {
    const [rows] = await db.execute(`SELECT bundle_id, url, position FROM bundle_images WHERE bundle_id IN (${ids.map(() => '?').join(',')}) ORDER BY position ASC`, ids);
    for (const row of rows) {
      const images = galleries.get(row.bundle_id) || [];
      images.push(row.url);
      galleries.set(row.bundle_id, images);
    }
  } catch (error: any) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
  }
  return galleries;
}

export async function replaceBundleGallery(conn: any, bundleId: string, images: string[]) {
  await conn.execute('DELETE FROM bundle_images WHERE bundle_id = ?', [bundleId]);
  for (const [position, url] of images.entries()) {
    await conn.execute('INSERT INTO bundle_images (id, bundle_id, url, position) VALUES (?, ?, ?, ?)', [randomUUID(), bundleId, url, position]);
  }
}

export async function deleteBundleGallery(conn: any, bundleId: string) {
  try { await conn.execute('DELETE FROM bundle_images WHERE bundle_id = ?', [bundleId]); }
  catch (error: any) { if (error.code !== 'ER_NO_SUCH_TABLE') throw error; }
}
