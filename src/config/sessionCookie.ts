// Cookie defaults preserve the existing production/development policy.
export const sessionCookieName = () => process.env.COOKIE_NAME?.trim() || 'leva_admin_token';
export const sessionCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const configuredSameSite = process.env.COOKIE_SAME_SITE;
  const sameSite: 'none' | 'lax' | 'strict' = configuredSameSite === 'none' || configuredSameSite === 'lax' || configuredSameSite === 'strict'
    ? configuredSameSite : (isProduction ? 'none' : 'lax');
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProduction,
    sameSite,
    ...(process.env.COOKIE_DOMAIN?.trim() ? { domain: process.env.COOKIE_DOMAIN.trim() } : {})
  };
};
