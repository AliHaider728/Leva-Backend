import { triggerSitemapRevalidation } from '../utils/revalidateSitemap';
import { Router } from 'express';
import * as fs from 'fs';
import { pool } from '../mysql-lib/db';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { randomUUID } from 'crypto';
import { validateBundleGallery, ensureBundleGallerySchema, getBundleGalleries, replaceBundleGallery, deleteBundleGallery } from '../mysql-lib/bundleGallery.js';

const router = Router();

// Define product columns to match standardized structure (same as products.ts)
const PRODUCT_COLS_P = 'p.id, p.name, p.slug, p.sku, p.price, p.originalPrice, p.discountPercent, p.rating, p.reviewCount, p.categoryId, p.brand, p.inStock, p.trackInventory, p.stockQuantity, p.stockStatus, p.lowStockThreshold, p.isVisible, p.status, p.displayOrder, p.isFeatured, p.isBestseller, p.isNewArrival, p.isSpotlight, p.weight, p.deliveryType, p.customDeliveryFee, p.shortDescription, p.description, p.features, p.safetyInfo, p.specifications, p.tags, p.metaTitle, p.metaDescription, p.productDetailBlocks, p.pricingOffers, p.defaultAttributes, p.defaultVariationId, p.productType, p.createdAt, p.updatedAt';
const PRODUCT_IMAGE_COLS = 'id, product_id, url, publicId, isThumbnail, position';
const PRODUCT_VARIANT_COLS = 'id, product_id, sku, regularPrice, salePrice, manageStock, stockQuantity, stockStatus, weight, attributes, image, enabled';

// Helper to safely parse JSON
const parseJson = (val: any, fallback: any = null) => {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch (e) { return fallback; }
};

// ==========================================
// PUBLIC ROUTES
// ==========================================

// List bundles
router.get('/', async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    const query = showAll 
      ? 'SELECT * FROM bundles ORDER BY displayOrder ASC'
      : 'SELECT * FROM bundles WHERE isActive = 1 ORDER BY displayOrder ASC';
      
    const [bundles] = await pool.execute(query);
    const bundlesArray = bundles as any[];

    if (bundlesArray.length === 0) {
      return res.json({ bundles: [] });
    }

    const bundleIds = bundlesArray.map(b => b.id);
    const galleries = await getBundleGalleries(bundleIds);
    const placeholders = bundleIds.map(() => '?').join(',');

    // Fetch linked products
    const [linkedRows] = await pool.execute(`
      SELECT bp.bundle_id, bp.quantity as bundle_quantity, ${PRODUCT_COLS_P}
      FROM bundle_products bp
      JOIN products p ON bp.product_id = p.id
      WHERE bp.bundle_id IN (${placeholders})
      AND p.isVisible = 1 AND p.status != 'draft'
    `, bundleIds);
    const productsArray = linkedRows as any[];

    // If products exist, fetch images and variants for them
    let imagesByProduct = new Map();
    let variantsByProduct = new Map();
    
    if (productsArray.length > 0) {
      const productIds = Array.from(new Set(productsArray.map(p => p.id)));
      const pPlaceholders = productIds.map(() => '?').join(',');
      
      const [images] = await pool.execute(`SELECT ${PRODUCT_IMAGE_COLS} FROM product_images WHERE product_id IN (${pPlaceholders}) ORDER BY position ASC`, productIds);
      (images as any[]).forEach(img => {
        if (!imagesByProduct.has(img.product_id)) imagesByProduct.set(img.product_id, []);
        imagesByProduct.get(img.product_id).push(img);
      });

      const [variants] = await pool.execute(`SELECT ${PRODUCT_VARIANT_COLS} FROM product_variants WHERE product_id IN (${pPlaceholders})`, productIds);
      (variants as any[]).forEach(v => {
        if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, []);
        variantsByProduct.get(v.product_id).push({ ...v, attributes: parseJson(v.attributes, {}), image: parseJson(v.image, null) });
      });
    }

    // Map everything together
    const result = bundlesArray.map(bundle => {
      const items = productsArray.filter(lp => lp.bundle_id === bundle.id).map(p => {
        return {
          ...p,
          bundle_quantity: p.bundle_quantity,
          features: parseJson(p.features, []),
          specifications: parseJson(p.specifications, []),
          tags: parseJson(p.tags, []),
          pricingOffers: parseJson(p.pricingOffers, []),
          images: (imagesByProduct.get(p.id) || []).map((img: any) => img.url),
          imagePublicIds: (imagesByProduct.get(p.id) || []).map((img: any) => img.publicId),
          variants: variantsByProduct.get(p.id) || []
        };
      });

      const originalTotalPrice = items.reduce((sum, item) => sum + (Number(item.price) * item.bundle_quantity), 0);
      let currentPrice = originalTotalPrice;
      if (bundle.discountType === 'percentage') {
        currentPrice = originalTotalPrice * (1 - (Number(bundle.discountValue || bundle.discountPercent || 0) / 100));
      } else if (bundle.discountType === 'fixed') {
        currentPrice = Math.max(0, originalTotalPrice - Number(bundle.discountValue || 0));
      } else if (bundle.discountType === 'custom') {
        currentPrice = Number(bundle.customPrice || bundle.bundlePrice || originalTotalPrice);
      } else {
        currentPrice = originalTotalPrice - (originalTotalPrice * (Number(bundle.discountPercent || 0) / 100));
      }

      return {
        ...bundle,
        galleryImages: galleries.get(bundle.id) || [],
        isActive: bundle.isActive === 1 || bundle.isActive === true,
        isBestseller: bundle.isBestseller === 1 || bundle.isBestseller === true,
        originalTotalPrice,
        currentPrice,
        products: items
      };
    });

    res.json({ bundles: result });
  } catch (error: any) {
    console.error('Error fetching bundles:', error);
    res.status(500).json({ error: 'Failed to fetch bundles' });
  }
});

// Single bundle detail
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const [bundles] = await pool.execute('SELECT * FROM bundles WHERE slug = ? AND isActive = 1 LIMIT 1', [slug]);
    const bundleRows = bundles as any[];

    if (bundleRows.length === 0) {
      return res.status(404).json({ error: 'Bundle not found' });
    }

    const bundle = bundleRows[0];
    const galleries = await getBundleGalleries([bundle.id]);

    const [linkedRows] = await pool.execute(`
      SELECT bp.bundle_id, bp.quantity as bundle_quantity, ${PRODUCT_COLS_P}
      FROM bundle_products bp
      JOIN products p ON bp.product_id = p.id
      WHERE bp.bundle_id = ?
      AND p.isVisible = 1 AND p.status != 'draft'
    `, [bundle.id]);
    const productsArray = linkedRows as any[];

    let imagesByProduct = new Map();
    let variantsByProduct = new Map();
    
    if (productsArray.length > 0) {
      const productIds = Array.from(new Set(productsArray.map(p => p.id)));
      const pPlaceholders = productIds.map(() => '?').join(',');
      
      const [images] = await pool.execute(`SELECT ${PRODUCT_IMAGE_COLS} FROM product_images WHERE product_id IN (${pPlaceholders}) ORDER BY position ASC`, productIds);
      (images as any[]).forEach(img => {
        if (!imagesByProduct.has(img.product_id)) imagesByProduct.set(img.product_id, []);
        imagesByProduct.get(img.product_id).push(img);
      });

      const [variants] = await pool.execute(`SELECT ${PRODUCT_VARIANT_COLS} FROM product_variants WHERE product_id IN (${pPlaceholders})`, productIds);
      (variants as any[]).forEach(v => {
        if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, []);
        variantsByProduct.get(v.product_id).push({ ...v, attributes: parseJson(v.attributes, {}), image: parseJson(v.image, null) });
      });
    }

    const items = productsArray.map(p => ({
      ...p,
      bundle_quantity: p.bundle_quantity,
      features: parseJson(p.features, []),
      specifications: parseJson(p.specifications, []),
      tags: parseJson(p.tags, []),
      pricingOffers: parseJson(p.pricingOffers, []),
      images: (imagesByProduct.get(p.id) || []).map((img: any) => img.url),
      imagePublicIds: (imagesByProduct.get(p.id) || []).map((img: any) => img.publicId),
      variants: variantsByProduct.get(p.id) || []
    }));

    const originalTotalPrice = items.reduce((sum, item) => sum + (Number(item.price) * item.bundle_quantity), 0);
    
    let currentPrice = originalTotalPrice;
    if (bundle.discountType === 'percentage') {
      currentPrice = originalTotalPrice * (1 - (Number(bundle.discountValue || bundle.discountPercent || 0) / 100));
    } else if (bundle.discountType === 'fixed') {
      currentPrice = Math.max(0, originalTotalPrice - Number(bundle.discountValue || 0));
    } else if (bundle.discountType === 'custom') {
      currentPrice = Number(bundle.customPrice || bundle.bundlePrice || originalTotalPrice);
    } else {
      currentPrice = originalTotalPrice - (originalTotalPrice * (Number(bundle.discountPercent || 0) / 100));
    }

    res.json({
      ...bundle,
      galleryImages: galleries.get(bundle.id) || [],
      isActive: bundle.isActive === 1 || bundle.isActive === true,
      isBestseller: bundle.isBestseller === 1 || bundle.isBestseller === true,
      originalTotalPrice,
      currentPrice,
      products: items
    });
  } catch (error: any) {
    console.error('Error fetching bundle:', error);
    fs.appendFileSync('debug.log', 'BUNDLE ERROR: ' + ((error as any).stack || String(error)) + '\n'); res.status(500).json({ error: 'Failed to fetch bundle' });
  }
});

// ==========================================
// ADMIN ROUTES
// ==========================================

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  let galleryImages: string[];
  try { galleryImages = validateBundleGallery(req.body.galleryImages === undefined ? [] : req.body.galleryImages); }
  catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  try { await ensureBundleGallerySchema(); }
  catch { return res.status(503).json({ error: 'Bundle gallery storage is unavailable. Please try again.' }); }
  const conn = await pool.getConnection();
  try {
    const { name, slug, description, shortDescription, image, customImage, discountPercent, isActive, status, isBestseller, displayOrder, products, bundlePrice, discountType, discountValue, customPrice } = req.body;
    
    // Validate required fields
    if (!name || !slug) {
      return res.status(400).json({ error: 'Name and slug are required' });
    }

    // Check for duplicate slug
    const [existing] = await conn.execute('SELECT id FROM bundles WHERE slug = ?', [slug]);
    if ((existing as any[]).length > 0) {
      return res.status(400).json({ error: 'Slug already exists' });
    }

    // Check products
    const validProductsToInsert: { product_id: string; quantity: number }[] = [];
    if (Array.isArray(products) && products.length > 0) {
      for (const p of products) {
        const [prodExists] = await conn.execute('SELECT id FROM products WHERE id = ?', [p.product_id]);
        if ((prodExists as any[]).length > 0) {
          validProductsToInsert.push({
            product_id: p.product_id,
            quantity: p.quantity || 1
          });
        }
      }
    }

    await conn.beginTransaction();
    // Lock existing rows so concurrent creates append without sharing a position.
    const [orderedBundles]: any = await conn.execute('SELECT id, displayOrder FROM bundles ORDER BY displayOrder ASC, id ASC FOR UPDATE');
    const nextDisplayOrder = orderedBundles.reduce((max: number, b: any) => Math.max(max, Number(b.displayOrder) || 0), -1) + 1;
    const bundleId = randomUUID();

    await conn.execute(
      `INSERT INTO bundles (id, name, slug, description, shortDescription, image, customImage, discountPercent, isActive, status, isBestseller, displayOrder, bundlePrice, discountType, discountValue, customPrice) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bundleId, 
        name, 
        slug, 
        description || '', 
        shortDescription || null,
        image || null, 
        customImage || null,
        discountPercent || 0, 
        isActive !== false ? 1 : 0, 
        status || 'published',
        isBestseller ? 1 : 0,
        nextDisplayOrder,
        bundlePrice || null,
        discountType || 'percentage',
        discountValue || 0,
        customPrice || 0
      ]
    );

    if (validProductsToInsert.length > 0) {
      for (const p of validProductsToInsert) {
        await conn.execute(
          'INSERT INTO bundle_products (bundle_id, product_id, quantity) VALUES (?, ?, ?)',
          [bundleId, p.product_id, p.quantity]
        );
      }
    }

    await replaceBundleGallery(conn, bundleId, galleryImages);
    await conn.commit();
    triggerSitemapRevalidation();
    res.status(201).json({ success: true, bundleId });
  } catch (error: any) {
    await conn.rollback();
    console.error('Error creating bundle:', error);
    res.status(500).json({ error: 'Failed to create bundle' });
  } finally {
    conn.release();
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  let galleryImages: string[] | undefined;
  try { if (req.body.galleryImages !== undefined) galleryImages = validateBundleGallery(req.body.galleryImages); }
  catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  if (galleryImages !== undefined) {
    try { await ensureBundleGallerySchema(); }
    catch { return res.status(503).json({ error: 'Bundle gallery storage is unavailable. Please try again.' }); }
  }
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { name, slug, description, shortDescription, image, customImage, discountPercent, isActive, status, isBestseller, displayOrder, products, bundlePrice, discountType, discountValue, customPrice } = req.body;
    
    const [existing] = await conn.execute('SELECT id FROM bundles WHERE id = ?', [id]);
    if ((existing as any[]).length === 0) {
      return res.status(404).json({ error: 'Bundle not found' });
    }

    if (slug) {
      const [dup] = await conn.execute('SELECT id FROM bundles WHERE slug = ? AND id != ?', [slug, id]);
      if ((dup as any[]).length > 0) {
        return res.status(400).json({ error: 'Slug already exists' });
      }
    }

    const validProductsToInsert: { product_id: string; quantity: number }[] = [];
    if (products !== undefined && Array.isArray(products)) {
      for (const p of products) {
        const [prodExists] = await conn.execute('SELECT id FROM products WHERE id = ?', [p.product_id]);
        if ((prodExists as any[]).length > 0) {
          validProductsToInsert.push({
            product_id: p.product_id,
            quantity: p.quantity || 1
          });
        }
      }
    }

    await conn.beginTransaction();

    // Serialize saves for this bundle, including gallery-only edits.
    const [locked] = await conn.execute('SELECT id FROM bundles WHERE id = ? FOR UPDATE', [id]);
    if (!(locked as any[]).length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Bundle not found' });
    }

    const updates = [];
    const values = [];
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (slug !== undefined) { updates.push('slug = ?'); values.push(slug); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (shortDescription !== undefined) { updates.push('shortDescription = ?'); values.push(shortDescription); }
    if (image !== undefined) { updates.push('image = ?'); values.push(image); }
    if (customImage !== undefined) { updates.push('customImage = ?'); values.push(customImage); }
    if (discountPercent !== undefined) { updates.push('discountPercent = ?'); values.push(discountPercent); }
    if (isActive !== undefined) { updates.push('isActive = ?'); values.push(isActive ? 1 : 0); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (isBestseller !== undefined) { updates.push('isBestseller = ?'); values.push(isBestseller ? 1 : 0); }
    if (displayOrder !== undefined) { updates.push('displayOrder = ?'); values.push(displayOrder); }
    if (bundlePrice !== undefined) { updates.push('bundlePrice = ?'); values.push(bundlePrice); }
    if (discountType !== undefined) { updates.push('discountType = ?'); values.push(discountType); }
    if (discountValue !== undefined) { updates.push('discountValue = ?'); values.push(discountValue); }
    if (customPrice !== undefined) { updates.push('customPrice = ?'); values.push(customPrice); }
    
    if (updates.length > 0) {
      values.push(id);
      await conn.execute(`UPDATE bundles SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    // Only update products if explicitly provided in payload
    if (products !== undefined) {
      await conn.execute('DELETE FROM bundle_products WHERE bundle_id = ?', [id]);
      
      for (const p of validProductsToInsert) {
        await conn.execute(
          'INSERT INTO bundle_products (bundle_id, product_id, quantity) VALUES (?, ?, ?)',
          [id, p.product_id, p.quantity]
        );
      }
    }

    if (galleryImages !== undefined) await replaceBundleGallery(conn, id, galleryImages);
    await conn.commit();
    triggerSitemapRevalidation();
    res.json({ success: true });
  } catch (error: any) {
    await conn.rollback();
    console.error('Error updating bundle:', error);
    res.status(500).json({ error: 'Failed to update bundle' });
  } finally {
    conn.release();
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    await conn.beginTransaction();
    const [result] = await conn.execute('DELETE FROM bundles WHERE id = ?', [id]);
    if ((result as any).affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Bundle not found' });
    }
    await deleteBundleGallery(conn, id);
    await conn.commit();
    triggerSitemapRevalidation();
    res.json({ success: true });
  } catch (error: any) {
    await conn.rollback();
    console.error('Error deleting bundle:', error);
    res.status(500).json({ error: 'Failed to delete bundle' });
  } finally { conn.release(); }
});

export default router;
