import { Router, Request, Response } from 'express';
import { pool } from '../mysql-lib/db.js';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js';
import sanitizeHtml from 'sanitize-html';
import crypto from 'crypto';

// ─── Explicit column lists (no SELECT *) ────────────────────────────────────
const REVIEW_COLS_PUBLIC = 'id, productId, productName, reviewerName, rating, title, content, avatarUrl, imageUrl, imagePublicId, verifiedPurchase, source, status, approvedAt, createdAt, updatedAt';
const REVIEW_COLS_ADMIN = 'id, productId, productName, reviewerName, reviewerEmail, rating, title, content, avatarUrl, imageUrl, imagePublicId, verifiedPurchase, source, status, userId, orderId, approvedAt, approvedBy, createdAt, updatedAt';

const router = Router();

const cleanText = (value: unknown, maximum: number) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum) : '';

const validEmail = (value: string) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// Recalculate and update a product's review summary stats (mirrors productReviews.ts logic)
async function recalculateProductReviewSummary(productId: string) {
  try {
    const [rows] = await pool.execute(
      `SELECT 
        COUNT(*) as reviewCount,
        ROUND(AVG(rating), 2) as averageRating,
        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as r1,
        SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as r2,
        SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as r3,
        SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as r4,
        SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as r5
       FROM reviews WHERE productId = ? AND status = 'approved'`,
      [productId]
    );

    const stats = (rows as any[])[0];
    const ratingDistribution = JSON.stringify({ 1: stats.r1, 2: stats.r2, 3: stats.r3, 4: stats.r4, 5: stats.r5 });

    // Only update the columns that exist in the migrated products table
    await pool.execute(
      `UPDATE products SET reviewCount = ?, updatedAt = ? WHERE id = ?`,
      [stats.reviewCount, new Date(), productId]
    );
  } catch (err) {
    console.error('[MySQL] Failed to recalculate review summary:', err);
  }
}

// GET approved reviews for a specific product (Public)
router.get('/product/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const [reviews] = await pool.execute(
      `SELECT ${REVIEW_COLS_PUBLIC} FROM reviews WHERE productId = ? AND status = "approved" ORDER BY createdAt DESC`,
      [productId]
    );
    res.json(reviews);
  } catch (err: any) {
    res.status(500).json({ error: 'Unable to complete this request.' });
  }
});

// POST submit a review (Public)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { productId, productName, reviewerName, reviewerEmail, rating, title, content } = req.body;

    const id = cleanText(productId, 255);
    const name = cleanText(reviewerName, 80);
    const email = cleanText(reviewerEmail, 254).toLowerCase();
    const reviewTitle = cleanText(title, 100);
    const numericRating = Number(rating);
    const sanitizedContent = sanitizeHtml(cleanText(content, 1000), { allowedTags: [], allowedAttributes: {} }).trim();

    if (!id || name.length < 2 || !sanitizedContent) {
      return res.status(400).json({ error: 'Missing required review fields' });
    }
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });

    // Never accept a client-provided product name as the authoritative product
    // association. This also prevents pending reviews for deleted products that
    // cannot be moderated meaningfully in the admin panel.
    const [products] = await pool.execute(
      'SELECT id, name FROM products WHERE (id = ? OR slug = ?) AND isVisible = 1 AND status != "draft" LIMIT 1',
      [id, id]
    );
    const product = (products as any[])[0];
    if (!product) return res.status(404).json({ error: 'This product is no longer available for reviews' });

    const reviewId = crypto.randomBytes(12).toString('hex');
    const now = new Date();

    await pool.execute(
      `INSERT INTO reviews (id, productId, productName, reviewerName, reviewerEmail, rating, title, content, status, source, verifiedPurchase, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reviewId, product.id, cleanText(product.name || productName, 255), name, email || null, numericRating, reviewTitle || null, sanitizedContent, 'pending', 'customer', 0, now, now]
    );

    const [rows] = await pool.execute(`SELECT ${REVIEW_COLS_PUBLIC} FROM reviews WHERE id = ?`, [reviewId]);
    res.status(201).json({
      message: 'Thank you! Your review has been submitted and will appear after approval.',
      review: (rows as any[])[0]
    });
  } catch (err: any) {
    res.status(400).json({ error: 'Unable to complete this request.' });
  }
});

// GET all reviews for Admin Moderation with filtering + SQL GROUP BY counts
router.get('/admin', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { status, source, rating, search, productId, page = 1, limit = 50 } = req.query;

    let whereClauses: string[] = [];
    let params: any[] = [];

    if (status) { whereClauses.push('r.status = ?'); params.push(status); }
    if (source) { whereClauses.push('r.source = ?'); params.push(source); }
    if (rating) { whereClauses.push('r.rating = ?'); params.push(Number(rating)); }
    if (productId) { whereClauses.push('r.productId = ?'); params.push(productId); }
    if (search) {
      whereClauses.push('(r.reviewerName LIKE ? OR r.productName LIKE ? OR r.content LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const skip = (Number(page) - 1) * Number(limit);

    const [reviews] = await pool.execute(
      `SELECT ${REVIEW_COLS_ADMIN.split(', ').map(c => `r.${c}`).join(', ')}, p.slug as productSlug
       FROM reviews r
       LEFT JOIN products p ON r.productId = p.id
       ${whereSQL}
       ORDER BY r.createdAt DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), skip]
    );

    const [totalRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM reviews r ${whereSQL}`,
      params
    );
    const total = (totalRows as any[])[0].total;

    // GROUP BY to mimic MongoDB $group aggregation for status counts
    const [countRows] = await pool.execute(
      `SELECT status, COUNT(*) as count FROM reviews GROUP BY status`
    );
    const countsObj: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
    (countRows as any[]).forEach(c => { countsObj[c.status] = c.count; });

    // Note: Product thumbnail images are in a separate product_images table.
    // For the admin list we expose productSlug for frontend navigation.
    const enrichedReviews = reviews as any[];

    res.json({
      reviews: enrichedReviews,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      counts: countsObj
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Unable to complete this request.' });
  }
});

// POST Admin creates a review (Admin)
router.post('/admin', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { productId, productName, reviewerName, rating, title, content, avatarUrl, imageUrl, imagePublicId, verifiedPurchase } = req.body;
    if (!productId || !rating || !content || !reviewerName) {
      return res.status(400).json({ error: 'Missing required review fields' });
    }

    const id = crypto.randomBytes(12).toString('hex');
    const now = new Date();

    await pool.execute(
      `INSERT INTO reviews (id, productId, productName, reviewerName, rating, title, content, avatarUrl, imageUrl, imagePublicId, status, source, verifiedPurchase, approvedAt, approvedBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, productId, productName || '', reviewerName, Number(rating), title || null, content, avatarUrl || null, imageUrl || null, imagePublicId || null, 'approved', 'admin', verifiedPurchase ? 1 : 0, now, req.user?.userId || null, now, now]
    );

    await recalculateProductReviewSummary(productId);

    const [rows] = await pool.execute(`SELECT ${REVIEW_COLS_ADMIN} FROM reviews WHERE id = ?`, [id]);
    res.status(201).json((rows as any[])[0]);
  } catch (err: any) {
    res.status(400).json({ error: 'Unable to complete this request.' });
  }
});

// PUT Approve Review (Admin)
router.put('/:id/approve', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    await pool.execute(
      'UPDATE reviews SET status = ?, approvedAt = ?, approvedBy = ?, updatedAt = ? WHERE id = ?',
      ['approved', now, req.user?.userId || null, now, req.params.id]
    );

    const [rows] = await pool.execute(`SELECT ${REVIEW_COLS_ADMIN} FROM reviews WHERE id = ?`, [req.params.id]);
    if ((rows as any[]).length === 0) return res.status(404).json({ error: 'Review not found' });

    const review = (rows as any[])[0];
    await recalculateProductReviewSummary(review.productId);
    res.json(review);
  } catch (err: any) {
    res.status(400).json({ error: 'Unable to complete this request.' });
  }
});

// PUT Reject Review (Admin)
router.put('/:id/reject', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await pool.execute(
      'UPDATE reviews SET status = ?, updatedAt = ? WHERE id = ?',
      ['rejected', new Date(), req.params.id]
    );

    const [rows] = await pool.execute(`SELECT ${REVIEW_COLS_ADMIN} FROM reviews WHERE id = ?`, [req.params.id]);
    if ((rows as any[]).length === 0) return res.status(404).json({ error: 'Review not found' });

    const review = (rows as any[])[0];
    await recalculateProductReviewSummary(review.productId);
    res.json(review);
  } catch (err: any) {
    res.status(400).json({ error: 'Unable to complete this request.' });
  }
});

// PUT Edit Review (Admin)
router.put('/:id', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { reviewerName, rating, title, content, avatarUrl, verifiedPurchase } = req.body;

    const setParts: string[] = ['updatedAt = ?'];
    const params: any[] = [new Date()];

    if (reviewerName !== undefined) { setParts.push('reviewerName = ?'); params.push(reviewerName); }
    if (rating !== undefined) { setParts.push('rating = ?'); params.push(Number(rating)); }
    if (title !== undefined) { setParts.push('title = ?'); params.push(title); }
    if (content !== undefined) { setParts.push('content = ?'); params.push(content); }
    if (avatarUrl !== undefined) { setParts.push('avatarUrl = ?'); params.push(avatarUrl); }
    if (verifiedPurchase !== undefined) { setParts.push('verifiedPurchase = ?'); params.push(verifiedPurchase ? 1 : 0); }

    params.push(req.params.id);
    await pool.execute(`UPDATE reviews SET ${setParts.join(', ')} WHERE id = ?`, params);

    const [rows] = await pool.execute(`SELECT ${REVIEW_COLS_ADMIN} FROM reviews WHERE id = ?`, [req.params.id]);
    if ((rows as any[]).length === 0) return res.status(404).json({ error: 'Review not found' });

    const review = (rows as any[])[0];
    if (review.status === 'approved') await recalculateProductReviewSummary(review.productId);

    res.json(review);
  } catch (err: any) {
    res.status(400).json({ error: 'Unable to complete this request.' });
  }
});

// DELETE Review (Admin)
router.delete('/:id', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.execute('SELECT productId, status FROM reviews WHERE id = ?', [req.params.id]);
    if ((rows as any[]).length === 0) return res.status(404).json({ error: 'Review not found' });

    const review = (rows as any[])[0];
    await pool.execute('DELETE FROM reviews WHERE id = ?', [req.params.id]);

    if (review.status === 'approved') await recalculateProductReviewSummary(review.productId);

    res.json({ message: 'Review deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Unable to complete this request.' });
  }
});

export default router;
