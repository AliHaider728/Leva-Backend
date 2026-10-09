import { ensureBundleGallerySchema } from '../mysql-lib/bundleGallery.js';
import { pool } from '../mysql-lib/db.js';

async function main() {
  try {
    await ensureBundleGallerySchema();
    console.log('Bundle gallery schema ready. Existing bundles retain empty galleries.');
  } finally { await pool.end(); }
}
main().catch(() => { console.error('Bundle gallery migration failed. Check database connectivity and CREATE permissions.'); process.exitCode = 1; });
