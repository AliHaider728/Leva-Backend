import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pool } from './src/mysql-lib/db.js';
import { uploadToR2 } from './src/lib/r2.js';

dotenv.config();

const imagesToUpload = [
  { file: 'media_1788431758671.png', name: 'Hydrating Hand & Body Cream', price: 2500, catName: 'Body Care', desc: 'Deeply moisturizing body cream formulated with rich shea butter and ceramides to restore your skin’s natural barrier. Absorbs quickly without leaving a greasy residue.' },
  { file: 'media_1788431768031.png', name: 'Urban Defense Daily Moisturizer', price: 3200, catName: 'Moisturizers', desc: 'A lightweight daily moisturizer that provides long-lasting hydration while protecting your skin from environmental stressors and pollution. Perfect for all skin types.' },
  { file: 'media_1788431782193.png', name: 'Purifying Mineral Clay Mask', price: 2100, catName: 'Treatments', desc: 'Detoxifying clay mask that draws out impurities, minimizes the appearance of pores, and leaves your skin feeling exceptionally clean, balanced, and glowing.' },
  { file: 'media_1788431788564.png', name: 'Radiance Renewal Essentials Kit', price: 8500, catName: 'Kits', desc: 'The complete 4-step radiance routine. Includes our signature gentle cleanser, revitalizing essence, berry refined scrub, and nourishing moisturizer.' },
  { file: 'media_1788431805428.png', name: 'Vitamin C Glow Serum', price: 4500, catName: 'Serums', desc: 'A potent Vitamin C serum that brightens uneven skin tone, reduces dark spots, and provides powerful antioxidant protection for a radiant, youthful complexion.' }
];

const sourceDir = 'C:/Users/MK Laptop/.gemini/antigravity/brain/76ee3eeb-d59d-4cbc-8300-fd3eef2c8aeb/.user_uploaded/';

async function seed() {
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    console.log('Starting seed process...');

    // 1. Ensure categories exist
    const categoryMap = new Map();
    for (const item of imagesToUpload) {
      if (!categoryMap.has(item.catName)) {
        const slug = item.catName.toLowerCase().replace(/ /g, '-');
        const [existing] = await conn.execute('SELECT id FROM categories WHERE slug = ?', [slug]);
        let catId;
        if ((existing as any[]).length > 0) {
          catId = (existing as any[])[0].id;
        } else {
          catId = crypto.randomUUID();
          await conn.execute(
            'INSERT INTO categories (id, name, slug, description, status, displayOrder, isFeatured, level, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [catId, item.catName, slug, `Shop our best ${item.catName}`, 'active', 1, 1, 0, new Date(), new Date()]
          );
          console.log(`Created category: ${item.catName}`);
        }
        categoryMap.set(item.catName, catId);
      }
    }

    // 2. Upload images to R2 and create products
    let order = 1;
    for (const item of imagesToUpload) {
      console.log(`Processing ${item.name}...`);
      
      const filePath = path.join(sourceDir, item.file);
      if (!fs.existsSync(filePath)) {
         throw new Error(`File not found: ${filePath}`);
      }

      const buffer = fs.readFileSync(filePath);
      const filename = `products/${Date.now()}-${item.file}`;
      
      console.log(`Uploading to R2...`);
      const url = await uploadToR2(buffer, filename, 'image/png');
      console.log(`Uploaded! URL: ${url}`);

      const productId = crypto.randomUUID();
      const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const catId = categoryMap.get(item.catName);

      // Insert product
      await conn.execute(
        `INSERT INTO products (
          id, name, slug, sku, price, originalPrice, discountPercent, rating, reviewCount, 
          categoryId, brand, inStock, trackInventory, stockQuantity, stockStatus, isVisible, status, 
          displayOrder, shortDescription, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          productId, item.name, slug, `SKU-${Date.now()}`, item.price, item.price, 0, 5.0, 12,
          catId, 'Alvora', 1, 0, 100, 'in_stock', 1, 'published', 
          order++, item.desc, new Date(), new Date()
        ]
      );

      // Insert product category mapping
      await conn.execute('INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)', [productId, catId]);

      // Insert image
      await conn.execute(
        'INSERT INTO product_images (id, product_id, url, publicId, isThumbnail, position) VALUES (?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), productId, url, filename, 0, 0]
      );

      console.log(`Created product: ${item.name}`);
    }

    await conn.commit();
    console.log('Seed complete!');
  } catch (err) {
    await conn.rollback();
    console.error('Seed failed:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

seed();
