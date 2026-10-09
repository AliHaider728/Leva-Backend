import { Router, Request, Response } from 'express';
import { pool } from '../mysql-lib/db.js';
import { authenticateToken, requireSuperAdmin } from '../middleware/auth.js';
import crypto from 'crypto';

// ─── Explicit column lists (no SELECT *) ────────────────────────────────────
const GLOBAL_ATTR_COLS = 'id, name, slug, displayType, createdAt, updatedAt';
const GLOBAL_TERM_COLS = 'id, attribute_id, label, slug, value, colorValue, imageUrl, imageAlt, position';

const router = Router();

// Helper to assemble attributes + terms
async function getAttributeWithTerms(id: string) {
  const [attrRows] = await pool.execute(`SELECT ${GLOBAL_ATTR_COLS} FROM global_attributes WHERE id = ?`, [id]);
  const attrs = attrRows as any[];
  if (attrs.length === 0) return null;
  const attr = attrs[0];
  const [termRows] = await pool.execute(`SELECT ${GLOBAL_TERM_COLS} FROM global_attribute_terms WHERE attribute_id = ? ORDER BY position ASC`, [id]);
  attr.terms = termRows as any[];
  return attr;
}

// GET all global attributes
router.get('/', async (req, res) => {
  try {
    const [attrRows] = await pool.execute(`SELECT ${GLOBAL_ATTR_COLS} FROM global_attributes ORDER BY createdAt DESC`);
    const attrs = attrRows as any[];
    
    if (attrs.length > 0) {
      const ids = attrs.map(a => `'${a.id}'`).join(',');
      const [termRows] = await pool.execute(`SELECT ${GLOBAL_TERM_COLS} FROM global_attribute_terms WHERE attribute_id IN (${ids}) ORDER BY position ASC`);
      const terms = termRows as any[];
      
      const termsMap = new Map();
      terms.forEach(t => {
        if (!termsMap.has(t.attribute_id)) termsMap.set(t.attribute_id, []);
        termsMap.get(t.attribute_id).push(t);
      });
      
      attrs.forEach(a => {
        a.terms = termsMap.get(a.id) || [];
      });
    }
    
    res.json(attrs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load global attributes' });
  }
});

// GET specific global attribute
router.get('/:id', async (req, res) => {
  try {
    const attr = await getAttributeWithTerms(req.params.id);
    if (!attr) return res.status(404).json({ error: 'Attribute not found' });
    res.json(attr);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load global attribute' });
  }
});

// POST create global attribute
router.post('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { name, slug, displayType } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'Name and slug are required' });

    const [existing] = await pool.execute('SELECT id FROM global_attributes WHERE slug = ?', [slug.toLowerCase()]);
    if ((existing as any[]).length > 0) return res.status(400).json({ error: 'Attribute slug must be unique' });

    const id = crypto.randomBytes(12).toString('hex');
    const now = new Date();

    await pool.execute(
      `INSERT INTO global_attributes (id, name, slug, displayType, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, slug.toLowerCase(), displayType || 'buttons', now, now]
    );

    // If terms are passed, insert them
    if (req.body.terms && Array.isArray(req.body.terms)) {
      for (let i = 0; i < req.body.terms.length; i++) {
        const t = req.body.terms[i];
        const termId = crypto.randomBytes(12).toString('hex');
        await pool.execute(
          `INSERT INTO global_attribute_terms (id, attribute_id, label, slug, value, colorValue, imageUrl, imageAlt, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [termId, id, t.label, t.slug, t.value, t.colorValue || null, t.imageUrl || null, t.imageAlt || null, i]
        );
      }
    }

    const attr = await getAttributeWithTerms(id);
    res.status(201).json(attr);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create global attribute' });
  }
});

// PUT update global attribute
router.put('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { name, slug, displayType } = req.body;
    
    const [existing] = await pool.execute(`SELECT ${GLOBAL_ATTR_COLS} FROM global_attributes WHERE id = ?`, [req.params.id]);
    if ((existing as any[]).length === 0) return res.status(404).json({ error: 'Attribute not found' });

    if (slug) {
      const [dup] = await pool.execute('SELECT id FROM global_attributes WHERE slug = ? AND id != ?', [slug.toLowerCase(), req.params.id]);
      if ((dup as any[]).length > 0) return res.status(400).json({ error: 'Attribute slug must be unique' });
    }

    await pool.execute(
      `UPDATE global_attributes SET name = COALESCE(?, name), slug = COALESCE(?, slug), displayType = COALESCE(?, displayType), updatedAt = ? WHERE id = ?`,
      [name || null, slug ? slug.toLowerCase() : null, displayType || null, new Date(), req.params.id]
    );

    res.json(await getAttributeWithTerms(req.params.id));
  } catch (error) {
    res.status(500).json({ error: 'Failed to update global attribute' });
  }
});

// DELETE global attribute
router.delete('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const [existing] = await pool.execute('SELECT id FROM global_attributes WHERE id = ?', [req.params.id]);
    if ((existing as any[]).length === 0) return res.status(404).json({ error: 'Attribute not found' });

    // Assuming we do not have an archive system anymore. Just raw delete. 
    // ON DELETE CASCADE on the foreign key handles the terms child table!
    await pool.execute('DELETE FROM global_attributes WHERE id = ?', [req.params.id]);
    res.json({ message: 'Attribute deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete global attribute' });
  }
});

// POST add term
router.post('/:id/terms', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const attr = await getAttributeWithTerms(req.params.id);
    if (!attr) return res.status(404).json({ error: 'Attribute not found' });

    const { label, slug, value, colorValue, imageUrl, imageAlt } = req.body;
    if (!label || !value || !slug) return res.status(400).json({ error: 'Label, slug, and value are required' });

    if (attr.terms.some((t: any) => t.slug === slug)) {
      return res.status(400).json({ error: 'Term slug must be unique within this attribute' });
    }

    const termId = crypto.randomBytes(12).toString('hex');
    await pool.execute(
      `INSERT INTO global_attribute_terms (id, attribute_id, label, slug, value, colorValue, imageUrl, imageAlt, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [termId, req.params.id, label, slug, value, colorValue || null, imageUrl || null, imageAlt || null, attr.terms.length]
    );

    res.status(201).json(await getAttributeWithTerms(req.params.id));
  } catch (error) {
    res.status(500).json({ error: 'Failed to add term' });
  }
});

// PUT update term
router.put('/:id/terms/:termId', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const attr = await getAttributeWithTerms(req.params.id);
    if (!attr) return res.status(404).json({ error: 'Attribute not found' });

    const term = attr.terms.find((t: any) => t.id === req.params.termId);
    if (!term) return res.status(404).json({ error: 'Term not found' });

    const { label, slug, value, colorValue, imageUrl, imageAlt } = req.body;

    if (slug && slug !== term.slug) {
      if (attr.terms.some((t: any) => t.slug === slug && t.id !== req.params.termId)) {
        return res.status(400).json({ error: 'Term slug must be unique within this attribute' });
      }
    }

    await pool.execute(
      `UPDATE global_attribute_terms 
       SET label = COALESCE(?, label), slug = COALESCE(?, slug), value = COALESCE(?, value), 
           colorValue = COALESCE(?, colorValue), imageUrl = COALESCE(?, imageUrl), imageAlt = COALESCE(?, imageAlt)
       WHERE id = ?`,
      [label || null, slug || null, value || null, colorValue || null, imageUrl || null, imageAlt || null, req.params.termId]
    );

    res.json(await getAttributeWithTerms(req.params.id));
  } catch (error) {
    res.status(500).json({ error: 'Failed to update term' });
  }
});

// DELETE term
router.delete('/:id/terms/:termId', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM global_attribute_terms WHERE id = ? AND attribute_id = ?', [req.params.termId, req.params.id]);
    if ((result as any).affectedRows === 0) return res.status(404).json({ error: 'Term not found' });

    res.json(await getAttributeWithTerms(req.params.id));
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete term' });
  }
});

export default router;
