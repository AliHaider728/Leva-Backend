import { triggerSitemapRevalidation } from '../utils/revalidateSitemap';
import { Router, Request, Response } from 'express';
import { pool } from '../mysql-lib/db.js';
import { AuthRequest, authenticateIfPresent, authenticateToken, requireAdmin } from '../middleware/auth.js';
import {
  normalizeProductDetailBlocks,
  sanitizeProductDescription,
  sanitizeAndScopeProductCss
} from '../lib/productContent.js';
import { normalizeInventory } from '../lib/inventory.js';
import crypto from 'crypto';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

const createSlug = (value: unknown): string =>
  String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const sanitizePlain = (v: unknown, max: number) =>
  String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const parseJson = (v: any, fallback: any = null) => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

// ─── Explicit column lists (no SELECT *) ────────────────────────────────────
const PRODUCT_COL_LIST = ['id','name','slug','sku','price','originalPrice','discountPercent','rating','reviewCount','categoryId','brand','inStock','trackInventory','stockQuantity','stockStatus','lowStockThreshold','isVisible','status','displayOrder','isFeatured','isBestseller','isNewArrival','isSpotlight','weight','deliveryType','customDeliveryFee','shortDescription','description','features','safetyInfo','specifications','tags','metaTitle','metaDescription','productDetailBlocks','productDetailCustomCss','pricingOffers','defaultAttributes','defaultVariationId','productType','createdAt','updatedAt','variants'];
const PRODUCT_COLS = PRODUCT_COL_LIST.join(', ');
const PRODUCT_COLS_P = PRODUCT_COL_LIST.map(c => `p.${c}`).join(', ');

const PRODUCT_IMAGE_COLS = 'product_id, url, publicId, isThumbnail, position';
const PRODUCT_VARIANT_COLS = 'id, product_id, sku, regularPrice, salePrice, manageStock, stockQuantity, stockStatus, weight, attributes, image, enabled';

// Assemble a full product: main row + images + categories + variants
async function getFullProduct(conn: any, idOrSlug: string, adminRead = false) {
  const visibilitySQL = adminRead ? '' : 'AND isVisible = 1 AND status != "draft"';
  const [rows] = await conn.execute(
    `SELECT ${PRODUCT_COLS} FROM products WHERE (id = ? OR slug = ?) ${visibilitySQL} LIMIT 1`,
    [idOrSlug, idOrSlug]
  );
  if ((rows as any[]).length === 0) return null;
  const p = (rows as any[])[0];
  const enriched = await enrichProducts(conn, [p]);
  return enriched[0] || null;
}

async function enrichProducts(conn: any, products: any[]) {
  if (!products || products.length === 0) return [];
  const productIds = products.map(p => p.id);
  const placeholders = productIds.map(() => '?').join(',');

  const [images] = await conn.execute(`SELECT ${PRODUCT_IMAGE_COLS} FROM product_images WHERE product_id IN (${placeholders}) ORDER BY product_id, position ASC`, productIds);
  const [pcats] = await conn.execute(`SELECT pc.product_id, c.id, c.name, c.slug FROM product_categories pc JOIN categories c ON pc.category_id = c.id WHERE pc.product_id IN (${placeholders})`, productIds);
  const [variants] = await conn.execute(`SELECT ${PRODUCT_VARIANT_COLS} FROM product_variants WHERE product_id IN (${placeholders})`, productIds);
  const [reviewsStats] = await conn.execute(`SELECT productId, COUNT(*) as count, ROUND(AVG(rating),1) as avgRating FROM reviews WHERE productId IN (${placeholders}) AND status = 'approved' GROUP BY productId`, productIds);

  const imagesByProduct = new Map();
  const categoriesByProduct = new Map();
  const variantsByProduct = new Map();
  const reviewsByProduct = new Map();

  (reviewsStats as any[]).forEach(row => { reviewsByProduct.set(row.productId, { count: row.count, rating: row.avgRating }); });
  (images as any[]).forEach(row => { if (!imagesByProduct.has(row.product_id)) imagesByProduct.set(row.product_id, []); imagesByProduct.get(row.product_id).push(row); });
  (pcats as any[]).forEach(row => { if (!categoriesByProduct.has(row.product_id)) categoriesByProduct.set(row.product_id, []); categoriesByProduct.get(row.product_id).push(row); });
  (variants as any[]).forEach(row => { if (!variantsByProduct.has(row.product_id)) variantsByProduct.set(row.product_id, []); variantsByProduct.get(row.product_id).push(row); });

  return products.map(p => {
    const imgs = imagesByProduct.get(p.id) || [];
    const cats = categoriesByProduct.get(p.id) || [];
    const vars = variantsByProduct.get(p.id) || [];

    return {
      ...p,
      price: Number(p.price || 0),
      originalPrice: p.originalPrice != null ? Number(p.originalPrice) : null,
      discountPercent: Number(p.discountPercent || 0),
      stockQuantity: p.stockQuantity != null ? Number(p.stockQuantity) : null,
      lowStockThreshold: p.lowStockThreshold != null ? Number(p.lowStockThreshold) : null,
      rating: reviewsByProduct.has(p.id) ? Number(reviewsByProduct.get(p.id).rating) : 0,
      reviewCount: reviewsByProduct.has(p.id) ? Number(reviewsByProduct.get(p.id).count) : 0,
      weight: p.weight != null ? Number(p.weight) : null,
      customDeliveryFee: p.customDeliveryFee != null ? Number(p.customDeliveryFee) : null,
      images: imgs.filter((i: any) => !i.isThumbnail).length > 0 ? imgs.filter((i: any) => !i.isThumbnail).map((i: any) => i.url) : imgs.map((i: any) => i.url),
      imageThumbnailUrls: imgs.filter((i: any) => i.isThumbnail).length > 0 ? imgs.filter((i: any) => i.isThumbnail).map((i: any) => i.url) : imgs.map((i: any) => i.url),
      imagePublicIds: imgs.map((i: any) => i.publicId).filter(Boolean),
      categoryIds: cats.map((c: any) => c.id),
      categoryNames: cats.map((c: any) => c.name),
      categorySlugs: cats.map((c: any) => c.slug),
      variations: vars.map((v: any) => ({
        ...v,
        regularPrice: Number(v.regularPrice || 0),
        salePrice: v.salePrice != null ? Number(v.salePrice) : null,
        stockQuantity: v.stockQuantity != null ? Number(v.stockQuantity) : null,
        weight: v.weight != null ? Number(v.weight) : null,
        attributes: parseJson(v.attributes, {}),
        image: parseJson(v.image, null)
      })),
      variants: parseJson(p.variants, []),
      features: parseJson(p.features, []),
      tags: parseJson(p.tags, []),
      specifications: parseJson(p.specifications, {}),
      productDetailBlocks: parseJson(p.productDetailBlocks, []),
      pricingOffers: parseJson(p.pricingOffers, null),
      defaultAttributes: parseJson(p.defaultAttributes, {})
    };
  });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET all products
router.get('/', authenticateIfPresent, async (req: AuthRequest, res: Response) => {
  try {
    const adminRead = ['admin', 'super_admin'].includes(req.user?.role || '');
    if (adminRead) { res.set('Cache-Control', 'no-store, max-age=0'); } else { res.set('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300'); }
    const { category, search, isVisible, limit } = req.query;

    const clauses: string[] = [];
    const params: any[] = [];

    if (!adminRead) { clauses.push('isVisible = 1 AND status != "draft"'); }
    else if (isVisible === 'true') { clauses.push('isVisible = 1'); }
    else if (isVisible === 'false') { clauses.push('isVisible = 0'); }

    if (category) {
      // join product_categories to filter by category slug
      clauses.push(`id IN (
        SELECT pc.product_id FROM product_categories pc
        JOIN categories c ON pc.category_id = c.id
        WHERE c.slug = ?
      )`);
      params.push(category);
    }

    if (search) {
      clauses.push('(name LIKE ? OR brand LIKE ? OR shortDescription LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limitSQL = limit ? `LIMIT ${Math.min(Number(limit), 500)}` : '';

    const [rows] = await pool.execute(`SELECT ${PRODUCT_COLS} FROM products ${where} ORDER BY displayOrder ASC, createdAt DESC ${limitSQL}`, params);
    res.json(await enrichProducts(pool, rows as any[]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET related products
router.get('/:idOrSlug/related', authenticateIfPresent, async (req: AuthRequest, res: Response) => {
  try {
    res.set('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
    const product = await getFullProduct(pool, req.params.idOrSlug);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    let related: any[] = [];
    if (product.categoryIds?.length > 0) {
      const placeholders = product.categoryIds.map(() => '?').join(',');
      const [catRelated] = await pool.execute(
        `SELECT DISTINCT ${PRODUCT_COLS_P} FROM products p
         JOIN product_categories pc ON p.id = pc.product_id
         WHERE pc.category_id IN (${placeholders}) AND p.id != ? AND p.isVisible = 1 AND p.status != "draft"
         LIMIT 4`,
        [...product.categoryIds, product.id]
      );
      related = catRelated as any[];
    }

    if (related.length < 4) {
      const excludeIds = [product.id, ...related.map(r => r.id)];
      const excPlaceholders = excludeIds.map(() => '?').join(',');
      const [fallback] = await pool.execute(
        `SELECT ${PRODUCT_COLS} FROM products WHERE id NOT IN (${excPlaceholders}) AND isVisible = 1 AND status != "draft" LIMIT ?`,
        [...excludeIds, 4 - related.length]
      );
      related = [...related, ...fallback as any[]];
    }

    res.json(await enrichProducts(pool, related));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET single product by slug or ID
router.get('/:idOrSlug', authenticateIfPresent, async (req: AuthRequest, res: Response) => {
  try {
    const adminRead = ['admin', 'super_admin'].includes(req.user?.role || '');
    if (adminRead) { res.set('Cache-Control', 'no-store, max-age=0'); } else { res.set('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300'); }
    const product = await getFullProduct(pool, req.params.idOrSlug, adminRead);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT Bulk Reorder
router.put('/reorder', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const updates = req.body as { id: string; displayOrder: number }[];
    if (!Array.isArray(updates)) return res.status(400).json({ error: 'Expected an array of updates' });

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      for (const u of updates) {
        await conn.execute('UPDATE products SET displayOrder = ? WHERE id = ?', [u.displayOrder, u.id]);
      }
      await conn.commit();
    triggerSitemapRevalidation();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    res.json({ success: true, message: 'Products reordered successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST Create Product
router.post('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const body = req.body;
    if (!body.name || !body.price) {
      await conn.rollback();
      return res.status(400).json({ error: 'Product name and price are required' });
    }

    const slug = createSlug(body.slug || body.name);

    // Slug uniqueness check
    const [existing] = await conn.execute('SELECT id FROM products WHERE slug = ?', [slug]);
    if ((existing as any[]).length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'URL slug is already used by another product' });
    }

    // Inventory normalization
    const inventory = normalizeInventory(body);
    const id = crypto.randomBytes(12).toString('hex');
    const now = new Date();

    const price = Number(body.price);
    const originalPrice = body.originalPrice ? Number(body.originalPrice) : null;
    const discountPercent = originalPrice ? Math.round(((originalPrice - price) / originalPrice) * 100) : 0;

    // Sanitize productDetailBlocks and CSS
    let productDetailBlocks: any[] = [];
    try { productDetailBlocks = normalizeProductDetailBlocks(body.productDetailBlocks); } catch { productDetailBlocks = []; }

    const description = sanitizeProductDescription(body.description || '');

    const customCss = body.productDetailCustomCss ? String(body.productDetailCustomCss).slice(0, 10000) : null;

    await conn.execute(
      `INSERT INTO products (id, name, slug, sku, price, originalPrice, discountPercent, 
        categoryId, brand, inStock, trackInventory, stockQuantity, stockStatus, lowStockThreshold, 
        isVisible, status, displayOrder, isFeatured, isBestseller, isNewArrival, isSpotlight, 
        weight, deliveryType, customDeliveryFee, shortDescription, description, 
        features, safetyInfo, specifications, tags, metaTitle, metaDescription, 
        productDetailBlocks, productDetailCustomCss, pricingOffers, defaultAttributes, defaultVariationId, productType, variants, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, sanitizePlain(body.name, 200), slug, sanitizePlain(body.sku, 80).toUpperCase() || null,
        price, originalPrice, discountPercent,
        body.categoryId || null,
        sanitizePlain(body.brand, 100) || 'Alvora',
        inventory.inStock ? 1 : 0,
        inventory.trackInventory ? 1 : 0,
        inventory.trackInventory ? (inventory.stockQuantity ?? null) : null,
        inventory.stockStatus || 'in_stock',
        inventory.trackInventory ? (inventory.lowStockThreshold ?? null) : null,
        body.isVisible !== false ? 1 : 0,
        ['draft', 'published'].includes(body.status) ? body.status : 'published',
        body.displayOrder ?? 0,
        body.isFeatured ? 1 : 0, body.isBestseller ? 1 : 0, body.isNewArrival ? 1 : 0, body.isSpotlight ? 1 : 0,
        body.weight != null ? Number(body.weight) : null,
        body.deliveryType || 'store_threshold',
        body.customDeliveryFee != null ? Number(body.customDeliveryFee) : null,
        sanitizePlain(body.shortDescription, 300),
        description,
        JSON.stringify(Array.isArray(body.features) ? body.features : []),
        sanitizePlain(body.safetyInfo, 500),
        JSON.stringify(body.specifications || {}),
        JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
        sanitizePlain(body.metaTitle, 70),
        sanitizePlain(body.metaDescription, 180),
        JSON.stringify(productDetailBlocks),
        customCss,
        JSON.stringify(body.pricingOffers || null),
        JSON.stringify(body.defaultAttributes || {}),
        body.defaultVariationId || null,
        body.productType === 'variable' ? 'variable' : 'simple',
        JSON.stringify(body.variants || []),
        now, now
      ]
    );

    // Insert images
    const images: string[] = Array.isArray(body.images) ? body.images : [];
    const thumbnails: string[] = Array.isArray(body.imageThumbnailUrls) ? body.imageThumbnailUrls : [];
    const publicIds: string[] = Array.isArray(body.imagePublicIds) ? body.imagePublicIds : [];

    for (let i = 0; i < images.length; i++) {
      await conn.execute(
        'INSERT INTO product_images (id, product_id, url, publicId, isThumbnail, position) VALUES (?, ?, ?, ?, ?, ?)',
        [crypto.randomBytes(8).toString('hex'), id, images[i], publicIds[i] || null, 0, i]
      );
    }
    for (let i = 0; i < thumbnails.length; i++) {
      await conn.execute(
        'INSERT INTO product_images (id, product_id, url, publicId, isThumbnail, position) VALUES (?, ?, ?, ?, ?, ?)',
        [crypto.randomBytes(8).toString('hex'), id, thumbnails[i], null, 1, i]
      );
    }

    // Insert category links
    const categoryIds: string[] = Array.isArray(body.categoryIds) ? body.categoryIds : (body.categoryId ? [body.categoryId] : []);
    for (const catId of categoryIds) {
      try { await conn.execute('INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)', [id, catId]); } catch { }
    }

    // Insert variants (for variable products)
    const variations: any[] = Array.isArray(body.variations) ? body.variations : [];
    for (const v of variations) {
      const varId = sanitizePlain(v.id, 80) || crypto.randomBytes(8).toString('hex');
      const varInventory = normalizeInventory(v);
      await conn.execute(
        'INSERT INTO product_variants (id, product_id, sku, regularPrice, salePrice, manageStock, stockQuantity, stockStatus, weight, attributes, image, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          varId, id, sanitizePlain(v.sku, 80).toUpperCase() || null,
          Number(v.regularPrice || price), v.salePrice != null ? Number(v.salePrice) : null,
          varInventory.trackInventory ? 1 : 0,
          varInventory.trackInventory ? (varInventory.stockQuantity ?? null) : null,
          varInventory.stockStatus || 'in_stock',
          v.weight != null ? Number(v.weight) : null,
          JSON.stringify(v.attributes || {}),
          JSON.stringify(v.image || null),
          v.enabled !== false ? 1 : 0
        ]
      );
    }

    await conn.commit();
    triggerSitemapRevalidation();

    const newProduct = await getFullProduct(pool, id, true);
    res.status(201).json(newProduct);
  } catch (err: any) {
    await conn.rollback();
    const isConflict = /already used|duplicate/i.test(err.message) || err.code === 'ER_DUP_ENTRY';
    res.status(isConflict ? 409 : 400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// PUT Update Product
router.put('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const [existingRows] = await conn.execute(`SELECT ${PRODUCT_COLS} FROM products WHERE id = ?`, [req.params.id]);
    if ((existingRows as any[]).length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Product not found' });
    }

    const current = (existingRows as any[])[0];
    const body = { ...parseJson(JSON.stringify(current), {}), ...req.body };
    const slug = createSlug(body.slug || body.name);
    const now = new Date();

    // Slug uniqueness check (excluding self)
    const [dupRows] = await conn.execute('SELECT id FROM products WHERE slug = ? AND id != ?', [slug, req.params.id]);
    if ((dupRows as any[]).length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'URL slug is already used by another product' });
    }

    const inventory = normalizeInventory(body);
    const price = Number(body.price);
    const originalPrice = body.originalPrice ? Number(body.originalPrice) : null;
    const discountPercent = originalPrice ? Math.round(((originalPrice - price) / originalPrice) * 100) : 0;

    let productDetailBlocks: any[] = [];
    try { productDetailBlocks = normalizeProductDetailBlocks(body.productDetailBlocks); } catch { productDetailBlocks = []; }

    const customCss = typeof body.productDetailCustomCss === 'string' ? String(body.productDetailCustomCss).slice(0, 10000) : current.productDetailCustomCss;

    await conn.execute(
      `UPDATE products SET name = ?, slug = ?, sku = ?, price = ?, originalPrice = ?, discountPercent = ?,
        categoryId = ?, brand = ?, inStock = ?, trackInventory = ?, stockQuantity = ?, stockStatus = ?, lowStockThreshold = ?,
        isVisible = ?, status = ?, displayOrder = ?, isFeatured = ?, isBestseller = ?, isNewArrival = ?, isSpotlight = ?,
        weight = ?, deliveryType = ?, customDeliveryFee = ?, shortDescription = ?, description = ?,
        features = ?, safetyInfo = ?, specifications = ?, tags = ?, metaTitle = ?, metaDescription = ?,
        productDetailBlocks = ?, productDetailCustomCss = ?, pricingOffers = ?, defaultAttributes = ?, defaultVariationId = ?, productType = ?, variants = ?, updatedAt = ?
       WHERE id = ?`,
      [
        sanitizePlain(body.name, 200), slug, sanitizePlain(body.sku, 80).toUpperCase() || null,
        price, originalPrice, discountPercent,
        body.categoryId || current.categoryId || null,
        sanitizePlain(body.brand, 100) || 'Alvora',
        inventory.inStock ? 1 : 0, inventory.trackInventory ? 1 : 0,
        inventory.trackInventory ? (inventory.stockQuantity ?? null) : null,
        inventory.stockStatus || 'in_stock',
        inventory.trackInventory ? (inventory.lowStockThreshold ?? null) : null,
        body.isVisible !== false ? 1 : 0,
        ['draft', 'published'].includes(body.status) ? body.status : current.status,
        body.displayOrder ?? current.displayOrder,
        body.isFeatured ? 1 : 0, body.isBestseller ? 1 : 0, body.isNewArrival ? 1 : 0, body.isSpotlight ? 1 : 0,
        body.weight != null ? Number(body.weight) : null,
        body.deliveryType || current.deliveryType || 'store_threshold',
        body.customDeliveryFee != null ? Number(body.customDeliveryFee) : null,
        sanitizePlain(body.shortDescription, 300),
        sanitizeProductDescription(body.description || current.description || ''),
        JSON.stringify(Array.isArray(body.features) ? body.features : []),
        sanitizePlain(body.safetyInfo, 500),
        JSON.stringify(body.specifications || {}),
        JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
        sanitizePlain(body.metaTitle, 70), sanitizePlain(body.metaDescription, 180),
        JSON.stringify(productDetailBlocks),
        customCss,
        JSON.stringify(body.pricingOffers || null),
        JSON.stringify(body.defaultAttributes || {}),
        body.defaultVariationId || null,
        body.productType === 'variable' ? 'variable' : 'simple',
        JSON.stringify(body.variants || []),
        now, req.params.id
      ]
    );

    // Sync images: delete old, reinsert new
    if (req.body.images !== undefined || req.body.imageThumbnailUrls !== undefined) {
      await conn.execute('DELETE FROM product_images WHERE product_id = ?', [req.params.id]);
      const images: string[] = Array.isArray(req.body.images) ? req.body.images : [];
      const thumbnails: string[] = Array.isArray(req.body.imageThumbnailUrls) ? req.body.imageThumbnailUrls : [];
      const publicIds: string[] = Array.isArray(req.body.imagePublicIds) ? req.body.imagePublicIds : [];
      for (let i = 0; i < images.length; i++) {
        await conn.execute(
          'INSERT INTO product_images (id, product_id, url, publicId, isThumbnail, position) VALUES (?, ?, ?, ?, ?, ?)',
          [crypto.randomBytes(8).toString('hex'), req.params.id, images[i], publicIds[i] || null, 0, i]
        );
      }
      for (let i = 0; i < thumbnails.length; i++) {
        await conn.execute(
          'INSERT INTO product_images (id, product_id, url, publicId, isThumbnail, position) VALUES (?, ?, ?, ?, ?, ?)',
          [crypto.randomBytes(8).toString('hex'), req.params.id, thumbnails[i], null, 1, i]
        );
      }
    }

    // Sync categories
    if (req.body.categoryIds !== undefined) {
      await conn.execute('DELETE FROM product_categories WHERE product_id = ?', [req.params.id]);
      const categoryIds: string[] = Array.isArray(req.body.categoryIds) ? req.body.categoryIds : [];
      for (const catId of categoryIds) {
        try { await conn.execute('INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)', [req.params.id, catId]); } catch { }
      }
    }

    // Sync variations
    if (req.body.variations !== undefined) {
      await conn.execute('DELETE FROM product_variants WHERE product_id = ?', [req.params.id]);
      for (const v of req.body.variations as any[]) {
        const varId = sanitizePlain(v.id, 80) || crypto.randomBytes(8).toString('hex');
        const varInventory = normalizeInventory(v);
        await conn.execute(
          'INSERT INTO product_variants (id, product_id, sku, regularPrice, salePrice, manageStock, stockQuantity, stockStatus, weight, attributes, image, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            varId, req.params.id, sanitizePlain(v.sku, 80).toUpperCase() || null,
            Number(v.regularPrice || price), v.salePrice != null ? Number(v.salePrice) : null,
            varInventory.trackInventory ? 1 : 0,
            varInventory.trackInventory ? (varInventory.stockQuantity ?? null) : null,
            varInventory.stockStatus || 'in_stock',
            v.weight != null ? Number(v.weight) : null,
            JSON.stringify(v.attributes || {}),
            JSON.stringify(v.image || null),
            v.enabled !== false ? 1 : 0
          ]
        );
      }
    }

    await conn.commit();
    triggerSitemapRevalidation();
    res.json(await getFullProduct(pool, req.params.id, true));
  } catch (err: any) {
    await conn.rollback();
    const isConflict = /already used/i.test(err.message) || err.code === 'ER_DUP_ENTRY';
    res.status(isConflict ? 409 : 400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// DELETE Product (Admin)
router.delete('/:id', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const [rows] = await conn.execute('SELECT id FROM products WHERE id = ?', [req.params.id]);
    if ((rows as any[]).length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Product not found' });
    }

    // Cascade deletes (product_images, product_categories, product_variants all have FK → products)
    await conn.execute('DELETE FROM products WHERE id = ?', [req.params.id]);
    await conn.commit();
    triggerSitemapRevalidation();
    res.json({ message: 'Product deleted successfully' });
  } catch (err: any) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

export default router;
