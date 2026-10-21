export const triggerSitemapRevalidation = async () => {
  const secret = process.env.SITEMAP_REVALIDATION_SECRET || process.env.REVALIDATION_SECRET || 'V9x!pR4mT8_kL2qN7wZ5@cD3yH6sF1bJ9uG0eX4a';
  const frontendUrl = (process.env.FRONTEND_URL || 'https://leva.pk').trim().replace(/\/+$/, '');

  if (!secret || !frontendUrl) {
    console.warn('[Sitemap] Revalidation skipped: SITEMAP_REVALIDATION_SECRET or FRONTEND_URL is not configured.');
    return;
  }

  try {
    // Non-blocking, fire-and-forget background fetch so we don't delay the API response
    // We append the URL securely using POST
    fetch(`${frontendUrl}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ secret }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          console.error(`[Sitemap] Revalidation failed with status ${res.status}:`, text);
        } else {
          console.log('[Sitemap] Revalidation successfully triggered.');
        }
      })
      .catch((err) => {
        console.error('[Sitemap] Revalidation request error:', err.message);
      });
  } catch (err) {
    console.error('[Sitemap] Failed to initiate revalidation:', err);
  }
};
