import { Router, Request, Response } from 'express';
import { pool } from '../mysql-lib/db.js';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import {
  DEFAULT_HOMEPAGE_SECTIONS,
  DEFAULT_STOREFRONT_NAVIGATION,
  normalizeStoredHomepageSections,
  normalizeStoredNavigation,
  validateAppearanceInput
} from '../config/storeAppearance.js';
import crypto from 'crypto';
import { getRoutineSettings, saveRoutineSettings } from '../mysql-lib/routineSettings.js';
import { validateRoutineSettings } from '../lib/routineDiscount.js';

const SETTINGS_COLS = 'id, storeName, email, phone, address, currency, freeShippingThreshold, standardShippingFee, taxRate, defaultMetaTitle, defaultMetaDescription, storefrontNavigation, homepageSections, socialLinks, createdAt, updatedAt';

const router = Router();

const cleanText = (value: unknown, maxLength: number) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

const finiteNumber = (value: unknown, field: string, maximum: number) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > maximum) {
    throw new Error(`${field} must be between 0 and ${maximum}`);
  }
  return number;
};

const getSettings = async () => {
  const [rows] = await pool.execute(`SELECT ${SETTINGS_COLS} FROM settings LIMIT 1`);
  let settings = (rows as any[])[0];
  
  if (!settings) {
    // Insert defaults if missing
    const id = crypto.randomBytes(12).toString('hex');
    const now = new Date();
    await pool.execute(
      `INSERT INTO settings (id, storeName, email, phone, address, currency, freeShippingThreshold, standardShippingFee, taxRate, defaultMetaTitle, defaultMetaDescription, storefrontNavigation, homepageSections, socialLinks, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, 'Alvora', 'sales@alvora.pk', '', '', 'Rs.', 5000, 250, 0, '', '',
        JSON.stringify(DEFAULT_STOREFRONT_NAVIGATION),
        JSON.stringify(DEFAULT_HOMEPAGE_SECTIONS),
        JSON.stringify({}),
        now, now
      ]
    );
    const [newRows] = await pool.execute(`SELECT ${SETTINGS_COLS} FROM settings LIMIT 1`);
    settings = (newRows as any[])[0];
  }
  return settings;
};

const resolvePublicNavigation = async (settings: any) => {
  const navigation = normalizeStoredNavigation(
    typeof settings.storefrontNavigation === 'string' 
      ? JSON.parse(settings.storefrontNavigation) 
      : settings.storefrontNavigation || []
  );
  
  // Note: 'status' in MySQL replaces isActive boolean, usually 'Active'/'Inactive'
  const [catRows] = await pool.execute('SELECT id, name, slug FROM categories WHERE status != "inactive" AND status != "Inactive" ORDER BY displayOrder ASC, name ASC');
  const categories = catRows as any[];
  
  const byId = new Map(categories.map(category => [category.id, category]));
  
  const resolved = navigation.flatMap((item: any) => {
    if (item.linkType !== 'category') return [{ ...item }];
    const category = byId.get(String(item.categoryId || ''));
    if (!category) return [];
    
    // In our new schema, showInNavigation, desktopVisible, etc., were not explicitly created.
    // They might be in a JSON column or derived. Assuming defaults for now.
    return [{
      ...item,
      label: item.label || category.name, // navigationLabel wasn't strictly migrated to column
      path: `/category/${category.slug}`,
      visible: item.visible,
      showOnDesktop: item.showOnDesktop,
      showOnMobile: item.showOnMobile
    }];
  });
  
  return resolved.map(({ isSystemItem: _internal, ...item }) => item);
};

const toPublicSettings = async (settings: any) => {
  const socialLinks = typeof settings.socialLinks === 'string' 
    ? JSON.parse(settings.socialLinks) 
    : settings.socialLinks || {};

  const homepageSections = typeof settings.homepageSections === 'string'
    ? JSON.parse(settings.homepageSections)
    : settings.homepageSections;

  return {
    storeName: settings.storeName,
    routineDiscount: await getRoutineSettings(),
    email: settings.email,
    phone: settings.phone,
    address: settings.address,
    currency: settings.currency,
    freeShippingThreshold: Number(settings.freeShippingThreshold) || 0,
    standardShippingFee: Number(settings.standardShippingFee) || 0,
    taxRate: Number(settings.taxRate) || 0,
    metaTitle: settings.defaultMetaTitle,
    metaDescription: settings.defaultMetaDescription,
    storefrontNavigation: await resolvePublicNavigation(settings),
    homepageSections: normalizeStoredHomepageSections(homepageSections || []),
    socialLinks: {
      instagram: socialLinks.instagram || 'https://www.instagram.com/alvoratoys',
      facebook: socialLinks.facebook || 'https://facebook.com/alvoratoys',
      youtube: socialLinks.youtube || 'https://youtube.com/@alvora',
      tiktok: socialLinks.tiktok || 'https://tiktok.com/@alvoratoys'
    }
  };
};

// GET safe storefront settings (Public)
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.json(await toPublicSettings(await getSettings()));
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'Could not load store settings' });
  }
});

router.get('/routine', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await getRoutineSettings());
  } catch {
    res.status(503).json({ error: 'Could not load routine discounts. Please try again.' });
  }
});

router.put('/routine', authenticateToken, requireAdmin, async (req, res) => {
  let settings;
  try { settings = validateRoutineSettings(req.body); }
  catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid routine discounts' }); }
  try { res.json(await saveRoutineSettings(settings)); }
  catch { res.status(500).json({ error: 'Could not save routine discounts. Please try again.' }); }
});

// PUT base store settings (Admin and Super Admin)
router.put('/', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const settings = await getSettings();
    const storeName = cleanText(req.body.storeName, 100);
    const email = cleanText(req.body.email, 160).toLowerCase();
    const phone = cleanText(req.body.phone, 60);
    const address = cleanText(req.body.address, 240);
    const currency = cleanText(req.body.currency, 12);
    const defaultMetaTitle = cleanText(req.body.metaTitle ?? req.body.defaultMetaTitle, 70);
    const defaultMetaDescription = cleanText(req.body.metaDescription ?? req.body.defaultMetaDescription, 180);
    
    if (!storeName || !email || !phone || !address || !currency) {
      return res.status(400).json({ error: 'Complete all required store settings' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid support email address' });
    }
    
    const now = new Date();
    await pool.execute(
      `UPDATE settings SET 
        storeName = ?, email = ?, phone = ?, address = ?, currency = ?, 
        freeShippingThreshold = ?, standardShippingFee = ?, taxRate = ?, 
        defaultMetaTitle = ?, defaultMetaDescription = ?, updatedAt = ?
       WHERE id = ?`,
      [
        storeName, email, phone, address, currency,
        finiteNumber(req.body.freeShippingThreshold, 'Free shipping threshold', 10000000),
        finiteNumber(req.body.standardShippingFee, 'Standard shipping fee', 1000000),
        finiteNumber(req.body.taxRate, 'Tax rate', 1),
        defaultMetaTitle, defaultMetaDescription, now, settings.id
      ]
    );
    
    const updated = await getSettings();
    res.json(await toPublicSettings(updated));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid store settings' });
  }
});

// PUT storefront appearance (Super Admin only)
// Adding a simple PUT /social endpoint just for testing the JSON logic safely
router.put('/social', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const settings = await getSettings();
    const currentSocial = typeof settings.socialLinks === 'string' ? JSON.parse(settings.socialLinks) : (settings.socialLinks || {});
    
    const newSocial = { ...currentSocial, ...req.body.socialLinks };
    
    await pool.execute('UPDATE settings SET socialLinks = ? WHERE id = ?', [JSON.stringify(newSocial), settings.id]);
    
    const updated = await getSettings();
    res.json(await toPublicSettings(updated));
  } catch (error) {
    res.status(400).json({ error: 'Failed to update social links' });
  }
});

export default router;
