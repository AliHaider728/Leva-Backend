import { createResetToken, resetDigest, resetMatches, RESET_MAX_ATTEMPTS } from '../lib/resetTokens.js';
import { limiter, accountLimiter } from '../middleware/security.js';
import { requireFeature } from '../middleware/features.js';
import { sessionCookieName, sessionCookieOptions } from '../config/sessionCookie.js';
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
router.post('/register', limiter(10), accountLimiter(3), async (req: Request, res: Response) => {
    try {
        const { name, email, password } = req.body;
        if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
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
        await pool.execute(`INSERT INTO users (id, name, email, passwordHash, role, wishlist, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, finalName, normalizedEmail, passwordHash, 'customer', '[]', now, now]);
        res.status(201).json({ message: 'Account created successfully. Please sign in to continue.' });
    }
    catch (err: any) {
        res.status(500).json({ error: 'Unable to complete this request.' });
    }
});
// POST /login
router.post('/login', limiter(20), accountLimiter(10), async (req: Request, res: Response) => {
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
        const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: '7d' });
        res.cookie(sessionCookieName(), token, {
            ...sessionCookieOptions(),
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.json({
            message: 'Login successful',
            token,
            user: toPublicUser(user)
        });
    }
    catch (err: any) {
        res.status(500).json({ error: 'Unable to complete this request.' });
    }
});
// POST /logout
router.post('/logout', (req: Request, res: Response) => {
    res.clearCookie(sessionCookieName(), sessionCookieOptions());
    res.json({ message: 'Logged out successfully' });
});
// GET /me
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const [rows] = await pool.execute(`SELECT ${USER_COLS_SAFE} FROM users WHERE id = ?`, [req.user!.userId]);
        if ((rows as any[]).length === 0)
            return res.status(404).json({ error: 'User not found' });
        res.json(toPublicUser((rows as any[])[0]));
    }
    catch (err: any) {
        res.status(500).json({ error: 'Unable to complete this request.' });
    }
});
// POST /wishlist
router.post('/wishlist', requireFeature('wishlist'), authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const { wishlist } = req.body;
        await pool.execute('UPDATE users SET wishlist = ?, updatedAt = ? WHERE id = ?', [JSON.stringify(wishlist), new Date(), req.user!.userId]);
        const [rows] = await pool.execute('SELECT wishlist FROM users WHERE id = ?', [req.user!.userId]);
        const user = (rows as any[])[0];
        res.json({ wishlist: typeof user.wishlist === 'string' ? JSON.parse(user.wishlist) : (user.wishlist || []) });
    }
    catch (err: any) {
        res.status(500).json({ error: 'Unable to complete this request.' });
    }
});
// GET /users (Admin)
router.get('/users', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const [rows] = await pool.execute(`SELECT ${USER_COLS_SAFE} FROM users ORDER BY createdAt DESC`);
        res.json((rows as any[]).map(toPublicUser));
    }
    catch (err: any) {
        res.status(500).json({ error: 'Unable to complete this request.' });
    }
});
// POST /forgot-password
router.post('/forgot-password', limiter(5), accountLimiter(3), async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        if (typeof email !== 'string' || !email.trim())
            return res.status(400).json({ error: 'Email is required' });
        const normalizedEmail = email.trim().toLowerCase();
        const [rows] = await pool.execute('SELECT id, name, email FROM users WHERE email = ?', [normalizedEmail]);
        if ((rows as any[]).length === 0) {
            return res.json({ message: 'If an account exists, password reset instructions have been sent.' });
        }
        const user = (rows as any[])[0];
        const { token, digest, expires } = createResetToken();
        await pool.execute('UPDATE users SET resetPasswordToken = ?, resetPasswordExpires = ?,resetPasswordAttempts=0 WHERE id = ?', [digest, expires, user.id]);
        try {
            await sendPasswordResetEmail(user, token);
        }
        catch (e) {
            console.error('Failed to send reset email:', e);
        }
        res.json({ message: 'If an account exists, password reset instructions have been sent.' });
    }
    catch (err: any) {
        res.status(500).json({ error: 'Unable to complete this request.' });
    }
});
// POST /reset-password
router.post('/reset-password', limiter(10), accountLimiter(5), async (req: Request, res: Response) => { let conn: any; try {
    const { token, newPassword, email } = req.body;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || typeof newPassword !== 'string' || newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 72)
        return res.status(400).json({ error: 'Provide a valid reset token and a password of 8 or more characters (maximum 72 bytes).' });
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const withEmail = typeof email === 'string' && email.trim();
    const [rows] = await conn.execute('SELECT id,resetPasswordToken,resetPasswordExpires,resetPasswordAttempts FROM users WHERE ' + (withEmail ? 'email=?' : 'resetPasswordToken=?') + ' FOR UPDATE', [withEmail ? email.trim().toLowerCase() : resetDigest(token)]);
    const user = rows[0];
    if (!user || !user.resetPasswordToken || !user.resetPasswordExpires || new Date(user.resetPasswordExpires).getTime() <= Date.now() || Number(user.resetPasswordAttempts) >= RESET_MAX_ATTEMPTS) {
        await conn.rollback();
        return res.status(400).json({ error: 'Password reset token is invalid or has expired.' });
    }
    await conn.execute('UPDATE users SET resetPasswordAttempts=resetPasswordAttempts+1 WHERE id=?', [user.id]);
    if (!resetMatches(token, user.resetPasswordToken)) {
        await conn.commit();
        return res.status(400).json({ error: 'Password reset token is invalid or has expired.' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await conn.execute('UPDATE users SET passwordHash=?,resetPasswordToken=NULL,resetPasswordExpires=NULL,resetPasswordAttempts=0,updatedAt=NOW() WHERE id=?', [hash, user.id]);
    await conn.commit();
    res.json({ message: 'Password reset successfully. Please sign in.' });
}
catch {
    if (conn)
        await conn.rollback();
    res.status(503).json({ error: 'Unable to reset the password. Please try again.' });
}
finally {
    conn?.release();
} });
// POST /change-password
router.post('/change-password', limiter(10), authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const { newPassword, currentPassword } = req.body;
        if (typeof currentPassword !== 'string' || !currentPassword || typeof newPassword !== 'string' || newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 72) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        const [rows] = await pool.execute('SELECT id,passwordHash FROM users WHERE id = ?', [req.user!.userId]);
        if ((rows as any[]).length === 0)
            return res.status(404).json({ error: 'User not found' });
        if (!await bcrypt.compare(currentPassword, (rows as any[])[0].passwordHash))
            return res.status(401).json({ error: 'Current password is incorrect.' });
        const passwordHash = await bcrypt.hash(newPassword, 12);
        await pool.execute('UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ?', [passwordHash, new Date(), req.user!.userId]);
        res.json({ message: 'Password changed successfully.' });
    }
    catch (err: any) {
        res.status(500).json({ error: 'Unable to complete this request.' });
    }
});
export default router;
