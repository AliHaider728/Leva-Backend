import { authenticateIfPresent, AuthRequest } from './auth.js';
import { Request, Response, NextFunction } from 'express';
import { getFeatures, type FeatureFlag } from '../config/features.js';
export function requireFeature(flag: FeatureFlag) { return async (_req: Request, res: Response, next: NextFunction) => { try {
    if (_req.headers['x-leva-admin-request']==='1' && ['admin','super_admin'].includes((_req as AuthRequest).user?.role || '')) return next();
    if (!(await getFeatures())[flag])
        return res.status(404).json({ error: 'This feature is not available.' });
    next();
}
catch {
    res.status(503).json({ error: 'Feature settings are temporarily unavailable.' });
} }; }
