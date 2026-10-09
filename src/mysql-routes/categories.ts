import { triggerSitemapRevalidation } from '../utils/revalidateSitemap';
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import { pool } from '../mysql-lib/db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import crypto from 'crypto';

const CATEGORY_COLS = 'id, name, slug, description, parentId, image, status, displayOrder, isFeatured, level, createdAt, updatedAt';

const router = Router();

// Build nested tree
const buildTree = (categories: any[], parentId: string | null = null): any[] => {
  return categories
    .filter(c => c.parentId === parentId)
    .map(c => ({
      ...c,
      children: buildTree(categories, c.id)
    }));
};

router.get('/', async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.execute(`SELECT ${CATEGORY_COLS} FROM categories WHERE status != "inactive" ORDER BY displayOrder ASC, name ASC`);
    res.json(buildTree(rows as any[]));
  } catch (error) {
    fs.appendFileSync('debug.log', 'CAT ERROR: ' + ((error as any).stack || String(error)) + '\n'); res.status(500).json({ error: 'Could not load categories' });
  }
});

router.get('/admin/all', authenticateToken, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.execute(`SELECT ${CATEGORY_COLS} FROM categories ORDER BY displayOrder ASC, name ASC`);
    res.json(buildTree(rows as any[]));
  } catch (error) {
    fs.appendFileSync('debug.log', 'CAT ERROR: ' + ((error as any).stack || String(error)) + '\n'); res.status(500).json({ error: 'Could not load categories' });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, slug, description, parentId, image, status, displayOrder, isFeatured } = req.body;
    
    if (!name || !slug) return res.status(400).json({ error: 'Name and slug are required' });

    const [existing] = await pool.execute('SELECT id FROM categories WHERE slug = ?', [slug.toLowerCase()]);
    if ((existing as any[]).length > 0) return res.status(409).json({ error: 'Category slug is already in use' });

    if (parentId) {
      const [parentCheck] = await pool.execute('SELECT id FROM categories WHERE id = ?', [parentId]);
      if ((parentCheck as any[]).length === 0) return res.status(400).json({ error: 'Parent category not found' });
    }

    const id = crypto.randomBytes(12).toString('hex');
    const now = new Date();

    await pool.execute(
      `INSERT INTO categories (id, name, slug, description, parentId, image, status, displayOrder, isFeatured, level, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, name, slug.toLowerCase(), description || null, parentId || null, 
        image ? JSON.stringify(image) : null, status || 'active', 
        displayOrder || 0, isFeatured ? 1 : 0, parentId ? 1 : 0, now, now
      ]
    );

    const [newCat] = await pool.execute(`SELECT ${CATEGORY_COLS} FROM categories WHERE id = ?`, [id]);
    triggerSitemapRevalidation();
    res.status(201).json((newCat as any[])[0]);
  } catch (error: any) {
    res.status(400).json({ error: 'Could not create category' });
  }
});

router.get('/:id/delete-impact', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const [productsCountResult] = await pool.execute('SELECT COUNT(*) as count FROM product_categories WHERE category_id = ?', [req.params.id]);
    const productsAffected = (productsCountResult as any[])[0].count;

    const [settingsRows] = await pool.execute('SELECT storefrontNavigation FROM settings LIMIT 1');
    const setting = (settingsRows as any[])[0];
    let inNavigation = false;
    if (setting && setting.storefrontNavigation) {
      const nav = typeof setting.storefrontNavigation === 'string' ? JSON.parse(setting.storefrontNavigation) : setting.storefrontNavigation;
      inNavigation = nav.some((n: any) => n.categoryId === req.params.id);
    }
    
    res.json({ productsAffected, inNavigation });
  } catch (error) {
    res.status(500).json({ error: 'Could not get category impact' });
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, slug, description, parentId, status, displayOrder, isFeatured } = req.body;
    
    const [existing] = await pool.execute(`SELECT ${CATEGORY_COLS} FROM categories WHERE id = ?`, [req.params.id]);
    if ((existing as any[]).length === 0) return res.status(404).json({ error: 'Category not found' });

    if (slug) {
      const [dup] = await pool.execute('SELECT id FROM categories WHERE slug = ? AND id != ?', [slug.toLowerCase(), req.params.id]);
      if ((dup as any[]).length > 0) return res.status(409).json({ error: 'Category slug is already in use' });
    }

    if (parentId === req.params.id) {
      return res.status(400).json({ error: 'A category cannot be its own parent' });
    }

    await pool.execute(
      `UPDATE categories 
       SET name = COALESCE(?, name), slug = COALESCE(?, slug), description = COALESCE(?, description),
           parentId = ?, status = COALESCE(?, status), displayOrder = COALESCE(?, displayOrder),
           isFeatured = COALESCE(?, isFeatured), updatedAt = ?
       WHERE id = ?`,
      [name || null, slug ? slug.toLowerCase() : null, description || null, parentId || null, status || null, displayOrder ?? null, isFeatured !== undefined ? (isFeatured ? 1 : 0) : null, new Date(), req.params.id]
    );

    const [updated] = await pool.execute(`SELECT ${CATEGORY_COLS} FROM categories WHERE id = ?`, [req.params.id]);
    triggerSitemapRevalidation();
    res.json((updated as any[])[0]);
  } catch (error: any) {
    res.status(400).json({ error: 'Could not update category' });
  }
});

// DELETE WITH ATOMIC TRANSACTION
router.delete('/:id', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const { resolution, navigationResolution, targetCategoryId } = req.body;
  
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const [catRows] = await conn.execute('SELECT id FROM categories WHERE id = ?', [req.params.id]);
    if ((catRows as any[]).length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Category not found' });
    }

    // Product reassignment logic
    if (resolution === 'reassign') {
      if (!targetCategoryId || targetCategoryId === req.params.id) {
        throw new Error('Choose another category for reassignment');
      }
      // Reassign all products mapped to this category to the target category
      await conn.execute(
        `INSERT IGNORE INTO product_categories (product_id, category_id) 
         SELECT product_id, ? FROM product_categories WHERE category_id = ?`,
        [targetCategoryId, req.params.id]
      );
    } else if (resolution !== 'uncategorized') {
      const [prodCheck] = await conn.execute('SELECT product_id FROM product_categories WHERE category_id = ? LIMIT 1', [req.params.id]);
      if ((prodCheck as any[]).length > 0) {
        throw new Error('Choose how to reassign products before deleting this category');
      }
    }

    // Navigation logic
    const [settingsRows] = await conn.execute('SELECT id, storefrontNavigation FROM settings LIMIT 1');
    const setting = (settingsRows as any[])[0];
    if (setting) {
      let nav = typeof setting.storefrontNavigation === 'string' 
        ? JSON.parse(setting.storefrontNavigation) 
        : setting.storefrontNavigation || [];
      
      const inNav = nav.some((n: any) => n.categoryId === req.params.id);
      
      if (inNav) {
        if (navigationResolution === 'reassign') {
          nav = nav.map((n: any) => n.categoryId === req.params.id ? { ...n, categoryId: targetCategoryId } : n);
        } else if (navigationResolution === 'remove') {
          nav = nav.filter((n: any) => n.categoryId !== req.params.id && n.parentId !== req.params.id);
        } else {
          throw new Error('Choose how to resolve navigation links before deleting this category');
        }
        await conn.execute('UPDATE settings SET storefrontNavigation = ? WHERE id = ?', [JSON.stringify(nav), setting.id]);
      }
    }

    // Now delete the category itself. MySQL schema handles SET NULL for child parentId and CASCADE for product_categories!
    await conn.execute('DELETE FROM categories WHERE id = ?', [req.params.id]);
    
    await conn.commit();
    triggerSitemapRevalidation();
    res.json({ message: 'Category deleted successfully' });
  } catch (error: any) {
    await conn.rollback();
    res.status(409).json({ error: error.message || 'Could not delete category' });
  } finally {
    conn.release();
  }
});

export default router;
