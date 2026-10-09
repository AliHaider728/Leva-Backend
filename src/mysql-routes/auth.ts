import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../mysql-lib/db.js';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js';
import crypto from 'crypto';
import { sendPasswordResetEmail } from '../utils/mailer.js';

const router = Router();

// ─── Explicit column lists (no SELECT *) ────────────────────────────────────
const USER_COLS_AUTH = 'id, name, email, passwordHash, role, wishlist, resetPasswordToken, resetPasswordExpires, createdAt, updatedAt';
const USER_COLS_SAFE = 'id, name, email, role, wishlist, createdAt, updatedAt';

// Helper to convert DB rows to public User objects
const toPublicUser = (row: any) => {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    wishlist: typeof row.wishlist === 'string' ? JSON.parse(row.wishlist) : (row.wishlist || []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
};

// POST /register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    const normalizedEmail = email.trim().toLowerCase();
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if ((existing as any[]).length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const finalName = name ? name.trim() : normalizedEmail.split('@')[0];
    const id = crypto.randomBytes(12).toString('hex');
    const now = new Date();

    await pool.execute(
      `INSERT INTO users (id, name, email, passwordHash, role, wishlist, createdAt, updatedAt) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, finalName, normalizedEmail, passwordHash, 'customer', '[]', now, now]
    );

    res.status(201).json({ message: 'Account created successfully. Please sign in to continue.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const [rows] = await pool.execute(`SELECT ${USER_COLS_AUTH} FROM users WHERE email = ?`, [normalizedEmail]);
    if ((rows as any[]).length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = (rows as any[])[0];
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('JWT_SECRET is not configured');
      return res.status(503).json({ error: 'Authentication is not configured' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      jwtSecret,
      { expiresIn: '7d' }
    );
    console.log('[login] Signing JWT with role:', user.role, 'User:', user.email);

    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('pb_admin_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      message: 'Login successful',
      token,
      user: toPublicUser(user)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /logout
router.post('/logout', (req: Request, res: Response) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.clearCookie('pb_admin_token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax'
  });
  res.json({ message: 'Logged out successfully' });
});

// GET /me
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await pool.execute(`SELECT ${USER_COLS_SAFE} FROM users WHERE id = ?`, [req.user!.userId]);
    if ((rows as any[]).length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(toPublicUser((rows as any[])[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /wishlist
router.post('/wishlist', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { wishlist } = req.body;
    
    await pool.execute(
      'UPDATE users SET wishlist = ?, updatedAt = ? WHERE id = ?', 
      [JSON.stringify(wishlist), new Date(), req.user!.userId]
    );

    const [rows] = await pool.execute('SELECT wishlist FROM users WHERE id = ?', [req.user!.userId]);
    const user = (rows as any[])[0];
    
    res.json({ wishlist: typeof user.wishlist === 'string' ? JSON.parse(user.wishlist) : (user.wishlist || []) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /users (Admin)
router.get('/users', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await pool.execute(`SELECT ${USER_COLS_SAFE} FROM users ORDER BY createdAt DESC`);
    res.json((rows as any[]).map(toPublicUser));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /forgot-password
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = email.trim().toLowerCase();
    const [rows] = await pool.execute('SELECT id, name, email FROM users WHERE email = ?', [normalizedEmail]);
    if ((rows as any[]).length === 0) {
      return res.json({ message: 'If an account exists, a 6-digit verification code has been sent.' });
    }
    const user = (rows as any[])[0];

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 3600000); // 1 hour

    await pool.execute(
      'UPDATE users SET resetPasswordToken = ?, resetPasswordExpires = ? WHERE id = ?',
      [code, expires, user.id]
    );

    try {
      await sendPasswordResetEmail(user, code);
    } catch (e) {
      console.error('Failed to send reset email:', e);
    }

    res.json({ message: 'If an account exists, a 6-digit verification code has been sent.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /reset-password
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const now = new Date();
    const [rows] = await pool.execute(
      'SELECT id FROM users WHERE resetPasswordToken = ? AND resetPasswordExpires > ?',
      [token, now]
    );

    if ((rows as any[]).length === 0) {
      return res.status(400).json({ error: 'Password reset token is invalid or has expired.' });
    }

    const user = (rows as any[])[0];
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await pool.execute(
      'UPDATE users SET passwordHash = ?, resetPasswordToken = NULL, resetPasswordExpires = NULL, updatedAt = ? WHERE id = ?',
      [passwordHash, now, user.id]
    );

    res.json({ message: 'Password has been successfully reset. You may now log in.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /change-password
router.post('/change-password', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    const [rows] = await pool.execute('SELECT id FROM users WHERE id = ?', [req.user!.userId]);
    if ((rows as any[]).length === 0) return res.status(404).json({ error: 'User not found' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.execute(
      'UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ?',
      [passwordHash, new Date(), req.user!.userId]
    );

    res.json({ message: 'Password changed successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
