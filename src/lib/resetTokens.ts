import { randomBytes, createHash, timingSafeEqual } from 'crypto';
export const RESET_TTL_MS = 15 * 60 * 1000;
export const RESET_MAX_ATTEMPTS = 5;
export const resetDigest = (token: string) => createHash('sha256').update(token).digest('hex');
export const createResetToken = () => { const token = randomBytes(32).toString('hex'); return { token, digest: resetDigest(token), expires: new Date(Date.now() + RESET_TTL_MS) }; };
export const resetMatches = (token: string, digest: string) => { const actual = Buffer.from(resetDigest(token), 'hex'), expected = Buffer.from(digest || '', 'hex'); return expected.length === actual.length && timingSafeEqual(actual, expected); };
