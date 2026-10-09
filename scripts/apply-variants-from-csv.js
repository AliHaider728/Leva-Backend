/**
 * apply-variants-from-csv.js
 *
 * Reads variants-template.csv (filled in by the user) and:
 *  1. Parses the "Color:Red,Blue | Size:S,M" format into variants JSON.
 *  2. Generates every SKU combination (cartesian product of all group values).
 *  3. DRY-RUN by default: prints what WOULD be written. Pass --apply to write.
 *
 * Usage:
 *   node scripts/apply-variants-from-csv.js               <- dry run
 *   node scripts/apply-variants-from-csv.js --apply       <- write to DB
 */

'use strict';
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const CSV_PATH = path.join(__dirname, '..', 'variants-template.csv');
const DRY_RUN  = !process.argv.includes('--apply');

// ── helpers ────────────────────────────────────────────────────────────────

/** Parse "Color:Red,Blue | Size:S,M" -> [ { name:'Color', values:['Red','Blue'] }, … ] */
function parseGroupText(text) {
  if (!text || !text.trim()) return [];
  return text.split('|').map(g => {
    const colonIdx = g.indexOf(':');
    if (colonIdx === -1) throw new Error(`Bad group format: "${g.trim()}". Expected "Name:Val1,Val2"`);
    const name   = g.slice(0, colonIdx).trim();
    const values = g.slice(colonIdx + 1).split(',').map(v => v.trim()).filter(Boolean);
    if (!name) throw new Error(`Group has no name in: "${g.trim()}"`);
    if (values.length === 0) throw new Error(`Group "${name}" has no values.`);
    return { name, values };
  });
}

/** Cartesian product of arrays */
function cartesian(arrays) {
  return arrays.reduce((acc, cur) => acc.flatMap(a => cur.map(b => [...a, b])), [[]]);
}

/** slugify a value for use as an attribute key */
function toSlug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Parse very simple CSV (no quoted-comma support needed for our format) */
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    // Split only on the first N-1 commas where N = headers.length,
    // so the variant_groups value (which may contain commas) stays intact.
    const parts = line.split(',');
    const row = {};
    headers.forEach((h, i) => {
      // Re-join any overflow columns back into the last field
      row[h] = (i < headers.length - 1 ? parts[i] : parts.slice(i).join(',')).trim();
    });
    return row;
  });
}

// ── main ──────────────────────────────────────────────────────────────────

(async () => {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const rows = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));

  const pool = mysql.createPool({
    host:     process.env.MYSQL_HOST,
    user:     process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  console.log(DRY_RUN ? '\n=== DRY RUN — no DB writes ===\n' : '\n=== APPLYING TO DATABASE ===\n');

  for (const row of rows) {
    const { product_id, product_name, base_price, variant_groups } = row;

    if (!variant_groups || !variant_groups.trim()) {
      console.log(`⚠️  SKIP  ${product_name} (${product_id}) — variant_groups not filled in\n`);
      continue;
    }

    let groups;
    try {
      groups = parseGroupText(variant_groups);
    } catch (e) {
      console.error(`✗ PARSE ERROR for "${product_name}": ${e.message}\n`);
      continue;
    }

    // ── Build variants JSON (products.variants column) ──────────────────
    const variantsJson = groups.map((g, idx) => ({
      id:      `group-${idx + 1}`,
      name:    g.name,
      options: g.values.map(v => ({ id: toSlug(v), name: v })),
    }));

    // ── Build SKU combination rows (product_variants table) ─────────────
    const groupNames  = groups.map(g => g.name);
    const groupValues = groups.map(g => g.values);
    const combos      = cartesian(groupValues); // [ ['Red','S'], ['Red','M'], … ]

    const now = Date.now();
    const variantRows = combos.map((combo, i) => {
      const attributes = {};
      groupNames.forEach((name, j) => { attributes[toSlug(name)] = combo[j]; });
      return {
        id:            `var-${now}-${crypto.randomBytes(5).toString('hex')}-${i}`,
        product_id,
        sku:           null,
        regularPrice:  Number(base_price),
        salePrice:     null,
        manageStock:   0,
        stockQuantity: null,
        stockStatus:   'in_stock',
        weight:        null,
        attributes,
        image:         null,
        enabled:       1,
        label:         combo.join(' / '),
      };
    });

    // ── Print plan ──────────────────────────────────────────────────────
    console.log(`📦  ${product_name}  (${product_id})`);
    console.log(`    Variant groups → products.variants:`);
    variantsJson.forEach(g =>
      console.log(`      • ${g.name}: ${g.options.map(o => o.name).join(', ')}`)
    );
    console.log(`    SKU rows to insert into product_variants (${variantRows.length} combos):`);
    variantRows.forEach(v =>
      console.log(`      + [${v.label}]  attributes: ${JSON.stringify(v.attributes)}  regularPrice: ${v.regularPrice}  stock: unmanaged`)
    );
    console.log();

    // ── Apply ───────────────────────────────────────────────────────────
    if (!DRY_RUN) {
      const conn = await pool.getConnection();
      await conn.beginTransaction();
      try {
        await conn.execute(
          'UPDATE products SET variants = ? WHERE id = ?',
          [JSON.stringify(variantsJson), product_id]
        );

        // Clean slate — remove any old rows before re-inserting
        await conn.execute('DELETE FROM product_variants WHERE product_id = ?', [product_id]);

        for (const v of variantRows) {
          await conn.execute(
            `INSERT INTO product_variants
              (id, product_id, sku, regularPrice, salePrice, manageStock, stockQuantity,
               stockStatus, weight, attributes, image, enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              v.id, v.product_id, v.sku, v.regularPrice, v.salePrice,
              v.manageStock, v.stockQuantity, v.stockStatus, v.weight,
              JSON.stringify(v.attributes),
              v.image ? JSON.stringify(v.image) : null,
              v.enabled,
            ]
          );
        }

        await conn.commit();
        console.log(`    ✓ Applied to database.\n`);
      } catch (err) {
        await conn.rollback();
        console.error(`    ✗ Failed and rolled back: ${err.message}\n`);
      } finally {
        conn.release();
      }
    }
  }

  if (DRY_RUN) {
    console.log('=== Dry run complete. Fill in variants-template.csv then run with --apply to write. ===');
  } else {
    console.log('=== All done. ===');
  }

  process.exit(0);
})();
