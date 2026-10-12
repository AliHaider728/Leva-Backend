import { Request, Response, NextFunction, type ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createHash } from 'crypto';
import { ClientError, publicError } from '../lib/httpError.js';
export const limiter = (limit: number) => rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Please try again later.' } });
export const accountLimiter = (limit: number) => rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req: Request) => createHash('sha256').update(String(req.body?.email || '').trim().toLowerCase()).digest('hex'), skip: (req: Request) => typeof req.body?.email !== 'string', message: { error: 'Too many attempts. Please try again later.' } });
export function wrapAsyncRouter(router: any) { for (const layer of router.stack || []) {
    if (layer.route)
        for (const handle of layer.route.stack) {
            const fn = handle.handle;
            if (fn.length < 4)
                handle.handle = (req: Request, res: Response, next: NextFunction) => { try {
                    Promise.resolve(fn(req, res, next)).catch(next);
                }
                catch (error) {
                    next(error);
                } };
        }
} }
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => { if (res.headersSent)
    return _next(error); const code = error?.type === 'entity.too.large' || error?.code === 'LIMIT_FILE_SIZE' ? 413 : error instanceof SyntaxError ? 400 : error instanceof ClientError ? error.status : 500; res.status(code).json({ error: code === 413 ? 'Request exceeds the size limit.' : code === 400 ? 'Invalid request.' : publicError(error, 'Unable to complete this request.') }); };
