import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
  };
}

const parseCookies = (req: Request): Record<string, string> => {
  const list: Record<string, string> = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      list[parts.shift()!.trim()] = decodeURIComponent(parts.join('='));
    });
  }
  return list;
};

const getRequestToken = (req: Request) => {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return parseCookies(req).pb_admin_token || headerToken;
};

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = getRequestToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET is not configured');
    return res.status(503).json({ error: 'Authentication is not configured' });
  }

  jwt.verify(token, secret, (err: any, decoded: any) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired session token.' });
    }
    req.user = decoded as { userId: string; email: string; role: string };
    next();
  });
};

export const authenticateIfPresent = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = getRequestToken(req);
  if (!token) return next();
  const secret = process.env.JWT_SECRET;
  if (!secret) return next();
  try {
    req.user = jwt.verify(token, secret) as { userId: string; email: string; role: string };
    next();
  } catch {
    return next();
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  console.log('[requireAdmin] Path:', req.originalUrl, 'Method:', req.method, 'User:', req.user);
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
  next();
};

export const requireSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Access denied. Super Admin privileges required.' });
  }
  next();
};
