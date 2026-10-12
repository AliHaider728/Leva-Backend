# LEVA API changes

API routes are under /api. Cookie requests must include credentials. Admin routes accept admin or super_admin roles. Feature errors are 404; unavailable storage/services return sanitized errors.

## Features

GET /features returns a flat boolean map: categories, variants, bundles, routineBuilder, coupons, reviews, audioReviews, wishlist, contact, tracking.

PUT /features is admin-only and accepts a partial map of these keys with boolean values. Unknown keys and other value types are rejected. Environment defaults are used until settings.featureFlags has overrides. The explicit hardening migration enables persistent switching.

## COD checkout

POST /orders accepts customerName, phone, optional email, shippingAddress (including city), items, checkoutRequestId and optional coupon. Items contain productId, positive integer quantity, optional variationId, and productType='bundle' for bundles. Custom routines use the existing routineComponents identity/quantity shape when routineBuilder is on. Other payment methods are rejected; omitted paymentMethod defaults to COD.

checkoutRequestId is required (16–120 letters, digits, underscores or hyphens); use a fresh random ID per checkout and reuse it for retries. Prices, totals, shipping fees and asserted discount amounts are ignored. Coupon may be a string; legacy appliedCoupon.code is also accepted. Authenticated email/user_id come from the verified session. A request ID belonging to a different customer returns 409.

The server checks the unique database constraint before placing an order. Products/stock, bundle contents/pricing, settings and coupon rows are read under the order transaction. Coupon use and stock are rolled back if the order does not commit. Receipt responses retain the mapped order fields. Cancellation uses saved component snapshots so later bundle edits do not change restoration quantities. Historical orders without snapshots use their stored variation or current legacy bundle relationships.

POST /coupons/validate requires code and items (IDs/quantities with the same checkout shape). It computes from database values in a transaction that is rolled back; it does not consume coupon usage or stock. Client cartSubtotal is not authoritative. Response includes valid, code, discountAmount and subtotal.

## Admin orders

GET /orders is authenticated. Admin responses are always {orders,totalCount,page,totalPages}; default page 1, limit 25, maximum 100. search matches orderId, guestEmail and names extracted from shippingAddress JSON. status and email filters remain available. Customer lists retain their own-order array response.

GET /orders/:orderId returns the full owned/admin order including items and statusHistory. PUT /orders/:orderId/status is admin-only and accepts status and optional note. Cancelled orders cannot be reopened. PUT /orders/:orderId/tracking accepts trackingNumber and requires the tracking feature plus admin authentication.

## Accounts

POST /auth/login accepts email and password; the HttpOnly session cookie is authoritative. Never persist the returned JWT in browser storage. POST /auth/logout clears the session cookie. GET /auth/me returns safe account fields.

POST /auth/forgot-password accepts email and returns a uniform response. A secure 64-character reset token is emailed; only its hash is stored, with a 15-minute expiry.

POST /auth/reset-password accepts token and newPassword, optionally email. Supplying email enables persisted invalid-attempt counting for that account. Per-IP/account request limits apply; stored reset attempts are capped at five. Successful reset consumes the token. POST /auth/change-password requires currentPassword and newPassword plus a session. New passwords require at least 8 characters and at most 72 UTF-8 bytes.

No admin account is provisioned automatically. The explicit admin:setup script prompts for credentials or reads temporary process environment variables. Do not put credentials in configuration files.

## Privacy and uploads

Public /reviews responses exclude reviewerEmail. Admin moderation retains private fields. Audio uploads require admin authentication and audioReviews enabled; multipart field audio is limited to one file, 10 MB, supported audio MIME type and matching header. R2 validates TLS certificates.

Browser mutation origins must match FRONTEND_URL/CORS_ORIGINS. Per-process rate limits cover login, registration, forgot/reset/change password, order creation, reviews, contact and coupon validation. A shared limiter store is needed for a multi-instance deployment.
