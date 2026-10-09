import { Router, Request, Response } from 'express';
import { pool } from '../mysql-lib/db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { sendContactConfirmationEmail } from '../utils/mailer.js';
import crypto from 'crypto';

// ─── Explicit column lists (no SELECT *) ────────────────────────────────────
const CONTACT_COLS = 'id, name, email, subject, message, status, createdAt, updatedAt';

const router = Router();

// POST /api/mysql-test/contacts
router.post(`/`, async (req: Request, res: Response) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: `All fields are required` });
    }
    
    const id = crypto.randomBytes(12).toString(`hex`);
    const now = new Date();

    const [result] = await pool.execute(
      `INSERT INTO contacts (id, name, email, subject, message, status, createdAt, updatedAt) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, email, subject, message, `New`, now, now]
    );
    
    try {
      await sendContactConfirmationEmail(email, name);
    } catch (emailErr) {
      console.error(`Failed to send contact confirmation email:`, emailErr);
    }

    res.status(201).json({ 
      message: `Message sent successfully (MySQL)`, 
      contact: { id, name, email, subject, message, status: `New`, createdAt: now, updatedAt: now } 
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mysql-test/contacts (Admin only)
router.get(`/`, authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.execute(`SELECT ${CONTACT_COLS} FROM contacts ORDER BY createdAt DESC`);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/mysql-test/contacts/:id/status (Admin only)
router.put(`/:id/status`, authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (![`New`, `Read`, `Resolved`].includes(status)) {
      return res.status(400).json({ error: `Invalid status` });
    }
    
    const now = new Date();
    const [updateResult] = await pool.execute(
      `UPDATE contacts SET status = ?, updatedAt = ? WHERE id = ?`,
      [status, now, req.params.id]
    );

    const affectedRows = (updateResult as any).affectedRows;
    if (affectedRows === 0) {
      return res.status(404).json({ error: `Contact message not found` });
    }
    
    const [rows] = await pool.execute(`SELECT ${CONTACT_COLS} FROM contacts WHERE id = ?`, [req.params.id]);
    res.json((rows as any)[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/mysql-test/contacts/:id (Admin only)
router.delete(`/:id`, authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const [result] = await pool.execute(`DELETE FROM contacts WHERE id = ?`, [req.params.id]);
    const affectedRows = (result as any).affectedRows;
    if (affectedRows === 0) {
      return res.status(404).json({ error: `Contact message not found` });
    }
    res.json({ message: `Contact message deleted successfully` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
