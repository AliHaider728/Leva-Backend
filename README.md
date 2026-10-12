# LEVA Backend

Express + TypeScript commerce API backed by MySQL. It retains products, inventory, variants, categories, bundles, routines, coupons, accounts, wishlists, moderated reviews, audio reviews, contacts, COD orders and tracking. New order IDs use the LEV- prefix. Existing stored records are not rebranded automatically.

## Configuration

.env.example contains names with blank values only. Supply deployment environment values securely; do not commit secrets. DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME configure MySQL. DB_PORT defaults to 3306. No database is contacted by build or the isolated tests.

FRONTEND_URL and comma-separated CORS_ORIGINS configure storefront origins. Requests from other browser origins cannot perform mutations. ADMIN_APP_URL supplies admin links. STORE_NAME defaults to LEVA; SUPPORT_EMAIL, SUPPORT_PHONE and optional JSON STORE_SOCIAL_LINKS supply default support/social settings. Existing settings remain editable in MySQL.

JWT_SECRET signs cookie sessions. COOKIE_NAME defaults to leva_admin_token; COOKIE_DOMAIN, COOKIE_SECURE and COOKIE_SAME_SITE control cookie deployment. Production cookies default to Secure, HttpOnly and SameSite=None, requiring HTTPS. Set TRUST_PROXY_HOPS only to your verified reverse-proxy hop count; an unrestricted proxy trust setting is not used.

Images and audio use R2_* storage. Category/review/detail images also support CLOUDINARY_*. R2 TLS certificate validation is enabled. Product image uploads are limited to 5 MB; audio uploads to 10 MB, supported MIME types and matching file signatures.

Email is sent with Nodemailer over SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM. SUPPORT_EMAIL is the reply/support address. NEW_ORDER_NOTIFICATION_EMAILS supplies notification recipients. Password reset tokens expire after 15 minutes. SMTP acceptance and customer receipt are different outcomes.

META_* and TIKTOK_* configure marketing integrations, which run only with the tracking feature enabled. Revalidation uses FRONTEND_URL and SITEMAP_REVALIDATION_SECRET. No store domains/contact information are embedded in integration code.

## Feature flags

GET /api/features returns a flat object containing categories, variants, bundles, routineBuilder, coupons, reviews, audioReviews, wishlist, contact and tracking. PUT /api/features accepts a partial boolean object and requires admin or super_admin authentication. Persisted flags live in settings.featureFlags and override FEATURE_* environment defaults.

LEVA defaults: bundles, coupons, reviews, wishlist and contact on; categories, variants, routineBuilder, audioReviews and tracking off. Disabled feature endpoints return 404. Before the migration, public reads use environment defaults, while switching flags requires the storage migration. Other database errors return 503 rather than enabling features silently.

## Build and test without database access

- npm run build: safely clean generated dist output and compile TypeScript; does not start the API or run migrations.
- npm test: isolated HTTP and transaction tests. The real MySQL driver is blocked; database calls and mail are intercepted. No test credentials are saved to files.
- npm run dev: start the API; this can access MySQL.
- npm start: run the compiled API, including health checks that can access MySQL.
- node build-cpanel.mjs: compile and create deploy/leva-backend plus a deployment zip. Only the blank .env.example is included; .env files are filtered out. Configure production secrets separately.

Use a supported Node.js version compatible with dependencies (22 or 24 recommended). Legacy sample seed/import/delete scripts and database exports/backups are excluded.

## Explicit future database steps

These commands are not run during build, tests or packaging:

1. Back up the database and inspect existing schema/checkout ID duplicates.
2. npm run migrate:hardening: add settings.featureFlags, reset attempt storage, routine component snapshots and a unique checkoutRequestId index. It refuses duplicate request IDs instead of deleting orders. DDL can commit partially in MySQL; resolve any migration error before retrying. Existing sufficiently wide token columns are preserved.
3. npm run admin:setup: supply ADMIN_EMAIL in the process environment or interactive prompt; enter the chosen password at the hidden prompt. ADMIN_PASSWORD may be supplied only as a temporary process environment variable, never in a file. The script stores only a bcrypt hash in MySQL and creates/updates the named admin account. It never prints or writes the password to a file.

Checkout fails closed if its unique storage constraint is absent. Database migration and account setup remain explicit deployment tasks.

## Security and API compatibility

Prices, offers, bundle/routine discounts, coupon usage and shipping are loaded/calculated on the server in an order transaction. Client price/total/shipping/discount fields are ignored. Coupon expiry and usage limits are checked atomically. Repeated checkoutRequestId values return the same owned checkout; the phone/total heuristic is removed. Authenticated orders save user_id. Cancellation restores stored component snapshots and cannot reopen a cancelled order.

All new orders use COD; other supplied payment methods are rejected. Public review responses omit reviewerEmail. Password changes require currentPassword. Reset tokens are random, hashed, single-use and expire after 15 minutes; per-IP/account rate limits and persisted attempt limits apply. Helmet, 1 MB JSON/form body limits, bounded upload sizes and sanitized error handling are enabled. Rate-limit stores are process-local; use a shared store for deployments with multiple API instances.

See docs/API_CONTRACT.md for current request shapes. Admin order lists now always return a paginated object, capped at 100 per page. Coupon validation needs product IDs/quantities rather than a client subtotal. Reset tokens are 64-character values rather than numeric codes. Independently deployed frontends must adopt these contracts; frontend files are not changed here.
