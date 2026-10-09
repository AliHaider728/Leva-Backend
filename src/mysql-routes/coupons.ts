import { Router, Request, Response } from 'express';
import { pool } from '../mysql-lib/db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import crypto from 'crypto';

// ─── Explicit column lists (no SELECT *) ────────────────────────────────────
const COUPON_COLS = 'id, code, discountType, discountValue, minPurchase, isActive, expiryDate, usageLimit, usageCount, createdAt, updatedAt';

const router = Router();

const normalizeCouponPayload = (body: Record<string, any>, current: Record<string, any> = {}) => {
  const merged = { ...current, ...body };
  const code = String(merged.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
  const discountType = merged.discountType === 'flat' ? 'fixed' : merged.discountType;
  const discountValue = Number(merged.discountValue ?? merged.amount);
  const minPurchase = Number(merged.minPurchase ?? merged.minSpend ?? 0);
  const usageLimit = merged.usageLimit === undefined || merged.usageLimit === `` || merged.usageLimit === null ? null : Number(merged.usageLimit);
  const usageCount = merged.usageCount ?? 0;
  
  if (!code) throw new Error(`Coupon code is required`);
  if (![`percentage`, `fixed`].includes(discountType)) throw new Error(`Choose a valid discount type`);
  if (!Number.isFinite(discountValue) || discountValue <= 0) throw new Error(`Discount value must be greater than zero`);
  if (discountType === `percentage` && discountValue > 100) throw new Error(`Percentage discount cannot exceed 100`);
  if (!Number.isFinite(minPurchase) || minPurchase < 0) throw new Error(`Minimum purchase cannot be negative`);
  if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1)) throw new Error(`Usage limit must be a positive whole number`);
  
  const expiryDate = String(merged.expiryDate || ``).slice(0, 10) || null;
  const isActive = merged.isActive !== false;

  return { code, discountType, discountValue, minPurchase, usageLimit, usageCount, expiryDate, isActive };
};

// GET all coupons (Admin)
router.get(`/`, authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const [coupons] = await pool.execute(`SELECT ${COUPON_COLS} FROM coupons ORDER BY createdAt DESC`);
    res.json(coupons);
  } catch (err: any) { 
    res.status(500).json({ error: `Could not load coupons` }); 
  }
});

// POST Validate Coupon Code (Public for Checkout)
router.post(`/validate`, async (req: Request, res: Response) => {
  try {
    const { code, cartSubtotal } = req.body;
    if (!code) return res.status(400).json({ error: `Coupon code required` });

    const [rows] = await pool.execute(
      `SELECT ${COUPON_COLS} FROM coupons WHERE code = ? AND isActive = 1`, 
      [code.trim().toUpperCase()]
    );
    
    if ((rows as any[]).length === 0) {
      return res.status(404).json({ error: `Invalid or expired coupon code` });
    }

    const coupon = (rows as any[])[0];

    // Note: If you want to strictly check expiryDate logic, you would compare string dates here or in SQL
    if (coupon.minPurchase && cartSubtotal < Number(coupon.minPurchase)) {
      return res.status(400).json({
        error: `Minimum order purchase of Rs. ${coupon.minPurchase} required for coupon ${code}`
      });
    }

    // Additional check: Usage Limit
    if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
      return res.status(400).json({ error: `Coupon usage limit reached` });
    }

    let discountAmount = 0;
    const discountVal = Number(coupon.discountValue);
    
    if (coupon.discountType === `percentage`) {
      discountAmount = Math.round((cartSubtotal * discountVal) / 100);
    } else {
      discountAmount = discountVal;
    }

    res.json({
      valid: true,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: discountVal,
      discountAmount
    });
  } catch (err: any) { 
    res.status(500).json({ error: `Could not validate coupon` }); 
  }
});

// POST Create Coupon (Admin)
router.post(`/`, authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const data = normalizeCouponPayload(req.body);
    const id = crypto.randomBytes(12).toString(`hex`);
    const now = new Date();

    await pool.execute(
      `INSERT INTO coupons (id, code, discountType, discountValue, minPurchase, isActive, expiryDate, usageLimit, usageCount, createdAt, updatedAt) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, data.code, data.discountType, data.discountValue, data.minPurchase, 
        data.isActive ? 1 : 0, data.expiryDate, data.usageLimit, data.usageCount, now, now
      ]
    );

    const [rows] = await pool.execute(`SELECT ${COUPON_COLS} FROM coupons WHERE id = ?`, [id]);
    res.status(201).json((rows as any)[0]);
  } catch (error: any) { 
    if (error.code === `ER_DUP_ENTRY`) {
      return res.status(409).json({ error: `Coupon code is already in use` });
    }
    res.status(400).json({ error: error instanceof Error ? error.message : `Could not create coupon` }); 
  }
});

// PUT Update Coupon (Admin)
router.put(`/:id`, authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const [existingRows] = await pool.execute(`SELECT ${COUPON_COLS} FROM coupons WHERE id = ?`, [req.params.id]);
    if ((existingRows as any[]).length === 0) {
      return res.status(404).json({ error: `Coupon not found` });
    }

    const currentCoupon = (existingRows as any[])[0];
    
    // Convert boolean stored as 1/0 back to boolean for normalization
    currentCoupon.isActive = currentCoupon.isActive === 1 || currentCoupon.isActive === true;

    const data = normalizeCouponPayload(req.body, currentCoupon);
    const now = new Date();

    await pool.execute(
      `UPDATE coupons 
       SET code = ?, discountType = ?, discountValue = ?, minPurchase = ?, isActive = ?, expiryDate = ?, usageLimit = ?, updatedAt = ? 
       WHERE id = ?`,
      [
        data.code, data.discountType, data.discountValue, data.minPurchase, 
        data.isActive ? 1 : 0, data.expiryDate, data.usageLimit, now, req.params.id
      ]
    );

    const [updatedRows] = await pool.execute(`SELECT ${COUPON_COLS} FROM coupons WHERE id = ?`, [req.params.id]);
    res.json((updatedRows as any[])[0]);
  } catch (error: any) { 
    if (error.code === `ER_DUP_ENTRY`) {
      return res.status(409).json({ error: `Coupon code is already in use` });
    }
    res.status(400).json({ error: error instanceof Error ? error.message : `Could not update coupon` }); 
  }
});

// DELETE Coupon (Admin)
router.delete(`/:id`, authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const [result] = await pool.execute(`DELETE FROM coupons WHERE id = ?`, [req.params.id]);
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ error: `Coupon not found` });
    }
    res.json({ message: `Coupon deleted` });
  } catch (err: any) { 
    res.status(500).json({ error: `Could not delete coupon` }); 
  }
});

export default router;
