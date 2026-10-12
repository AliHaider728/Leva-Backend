# LEVA backend checkpoint

All changes are inside backend. No frontend files, database connections, migrations or real accounts were touched. No .env was created or filled and no password value was written to a file.

## Rebrand verification

The required case-insensitive tracked-file brand scan returned no matches (exit code 1). Package name is leva-backend, new order IDs use LEV-, support/store/CORS values use environment configuration, SMTP documentation matches the implementation, and the listed obsolete seed/import/delete/sample/backup/analysis files are absent. Generated output is cleaned before compiling, so stale deleted scripts cannot ship.

.env.example has grouped names and blank assignments only. cPanel packaging was executed successfully; archive inspection found only the blank .env.example and no local environment files. Existing production records/assets are not changed by source rebranding.

## Implemented source changes

- Settings-backed feature flags with strict env defaults. Public GET /api/features, admin-only PUT /api/features and disabled-feature 404 middleware. Defaults match the requested LEVA configuration.
- Server-authoritative product/variant/offer, bundle, routine, coupon and settings shipping calculations. Client monetary values are ignored. Coupon expiry/limits are checked under a row lock with an atomic bounded increment in the same transaction as the order.
- Required unique checkout request IDs with duplicate-key recovery, collision ownership checks, authenticated user_id storage and no phone/total heuristic. Checkout fails closed until its database constraint exists.
- Public reviewerEmail removal, R2 TLS validation, random hashed expiring reset tokens, persistent bounded attempts, current-password verification, per-IP/account rate limits, bounded audio upload types/signatures/sizes, Helmet, body limits, origin validation and sanitized errors.
- Admin order pagination capped at 100 and JSON address-name search instead of a missing customer column.
- Stock snapshots for products/variants/bundles, rollback on failed checkout, cancellation restoration based on purchased bundle contents, and cancelled-order reopening prevention.
- COD-only order creation. Other supplied payment methods are rejected.

## Actual checks

Builds passed after rebrand, feature flags (A), security (B), COD (C), and final deployment packaging. Logs are under verification/:

- rebrand-build.log
- features-build.log
- security-build.log
- cod-build.log
- final-build.log
- cpanel-build.log
- final-tests.log

npm test passed 24 database-free checks (17 hardening, 7 order transaction/controller checks). The real MySQL driver is blocked in tests; all SQL and mail calls are intercepted. Checks include price tampering, coupon usage/expiry, disabled features, admin access, reviewer privacy, reset hashing/expiry/attempt guards, current-password requirement, rate limits, body/audio bounds, security headers, origin blocking, pagination/search, successful user-linked COD checkout, idempotent retry, duplicate-key recovery/rollback, request-ID collisions and bundle cancellation after bundle changes.

## Remaining deployment steps

1. Apply npm run migrate:hardening during a separately authorized database step. It adds feature storage/reset attempt fields, ensures token capacity and component snapshots, and adds the unique checkout request index. It refuses duplicate IDs instead of deleting orders. MySQL DDL can commit partially; inspect and resolve any migration error before retrying.
2. Run npm run admin:setup in that database step. Supply the desired email through temporary ADMIN_EMAIL or the prompt and enter the selected password at the hidden prompt. No account credentials have been applied in this task. The script stores only a bcrypt hash in MySQL; never put ADMIN_PASSWORD in a file.
3. Validate live MySQL concurrency, existing-schema compatibility, SMTP delivery, R2/Cloudinary uploads and production proxy/cookie configuration. They were not exercised against real services.
4. Update the independent frontend in its own workspace step for always-paginated admin orders, ID/quantity-based coupon validation and 64-character reset tokens. The current admin dashboard expects an unpaginated order array and requires adaptation. Feature keys are exactly those documented in docs/API_CONTRACT.md. Tracking is off by default, so tracking updates return 404 until enabled.

Rate limits use process-local stores; a shared limiter store is required for consistent limits across multiple deployed API instances. New cancellation snapshots preserve purchased bundle contents; historical bundle orders without snapshots can only use current legacy bundle relationships. Existing database brand text is intentionally unchanged because database access was prohibited.

This is a clean source/build/test checkpoint. Operational hardening activation and the requested admin credentials remain pending the prohibited database step.
