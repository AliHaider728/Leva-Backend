import { Request, Response, NextFunction } from 'express';
import { getFeatures, type FeatureFlag } from '../config/features.js';
export function requireFeature(flag: FeatureFlag) { return async (_req: Request, res: Response, next: NextFunction) => { try {
    if (!(await getFeatures())[flag])
        return res.status(404).json({ error: 'This feature is not available.' });
    next();
}
catch {
    res.status(503).json({ error: 'Feature settings are temporarily unavailable.' });
} }; }
