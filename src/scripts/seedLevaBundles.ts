/** Explicit, idempotent LEVA bundles seed. Existing bundles are never overwritten or duplicated. */
import { randomUUID } from 'node:crypto';
import { pool } from '../mysql-lib/db.js';

interface SeedBundle {
  name: string;
  slug: string;
  description: string;
  image?: string;
  discountType: 'percentage';
  discountValue: number;
  discountPercent: number;
  isActive: boolean;
  isBestseller: boolean;
  status: string;
  displayOrder: number;
  productSlugs: string[];
}

const seedBundles: SeedBundle[] = [
  {
    name: 'The Complete Ritual',
    slug: 'complete-ritual',
    description: 'A complete three-step LEVA ritual: cleanse with Skin Brightening Face Wash, care with Skin Brightening Cream, then finish with Tinted Sunscreen SPF 50 PA+++.',
    image: '/images/leva-complete-ritual-bundle.webp',
    discountType: 'percentage',
    discountValue: 20,
    discountPercent: 20,
    isActive: true,
    isBestseller: true,
    status: 'published',
    displayOrder: 0,
    productSlugs: ['product-03', 'product-01', 'product-02']
  },
  {
    name: 'The Duo',
    slug: 'the-essentials',
    description: 'The brightening cream and tinted sunscreen, paired for a daytime ritual.',
    discountType: 'percentage',
    discountValue: 10,
    discountPercent: 10,
    isActive: true,
    isBestseller: false,
    status: 'published',
    displayOrder: 1,
    productSlugs: ['product-01', 'product-02']
  }
];

export async function seedBundlesToDatabase() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Map products by slug
    const [products]: any = await conn.execute('SELECT id, slug, name, price FROM products');
    const productBySlug = new Map<string, { id: string; name: string; price: number }>();
    for (const p of products) {
      productBySlug.set(p.slug, { id: p.id, name: p.name, price: Number(p.price) });
    }

    for (const b of seedBundles) {
      const [existing]: any = await conn.execute(
        'SELECT id FROM bundles WHERE slug = ? FOR UPDATE',
        [b.slug]
      );

      if (existing.length > 0) {
        console.log(`Existing bundle preserved: "${b.name}" (${b.slug})`);
        continue;
      }

      const bundleId = randomUUID();
      await conn.execute(
        `INSERT INTO bundles (
          id, name, slug, description, shortDescription, image, customImage,
          discountPercent, discountType, discountValue, customPrice, bundlePrice,
          isActive, status, isBestseller, displayOrder, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          bundleId,
          b.name,
          b.slug,
          b.description,
          b.description,
          b.image || null,
          b.image || null,
          b.discountPercent,
          b.discountType,
          b.discountValue,
          0,
          null,
          b.isActive ? 1 : 0,
          b.status,
          b.isBestseller ? 1 : 0,
          b.displayOrder
        ]
      );

      for (const productSlug of b.productSlugs) {
        const prod = productBySlug.get(productSlug);
        if (!prod) {
          throw new Error(`Product with slug "${productSlug}" not found in database.`);
        }
        await conn.execute(
          'INSERT INTO bundle_products (bundle_id, product_id, quantity) VALUES (?, ?, ?)',
          [bundleId, prod.id, 1]
        );
      }

      console.log(`Inserted bundle: "${b.name}" (${b.slug}) with ${b.productSlugs.length} products.`);
    }

    await conn.commit();
    console.log('LEVA bundles seed complete.');
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  seedBundlesToDatabase()
    .then(() => pool.end())
    .catch((err) => {
      console.error('Bundle seed failed:', err);
      process.exit(1);
    });
}
