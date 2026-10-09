# Alvora Skincare – Backend Technical Documentation

This document serves as a comprehensive guide to the Alvora backend (Node.js/Express + MySQL). It is designed to act as a complete handoff document for building or integrating a new frontend.

---

## 1. TECH STACK

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MySQL
- **Authentication:** JWT (JSON Web Tokens)
- **Image Hosting:** Cloudinary
- **Audio Hosting:** Cloudflare R2 (S3-compatible)
- **Email/SMTP:** Standard SMTP via Nodemailer
- **Hosting/Deployment:** Standard Node server (e.g., PM2, Docker, or Vercel depending on configuration)

---

## 2. DATABASE SCHEMA

The MySQL database (`tecnosphere_alvora`) contains the following tables:

### Core Tables

#### `users`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | varchar(255) | NO | | Primary Key |
| name | varchar(255) | YES | | |
| email | varchar(255) | YES | | Unique |
| passwordHash | varchar(255) | YES | | |
| role | varchar(50) | YES | | 'admin' or 'customer' |
| wishlist | longtext | YES | | JSON array of product IDs |
| resetPasswordToken | varchar(255) | YES | | |
| resetPasswordExpires | datetime | YES | | |
| createdAt / updatedAt | datetime | YES | | |

#### `settings`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | varchar(255) | NO | | Primary Key |
| storeName, email, phone | varchar(255) | YES | | Store details |
| address | text | YES | | |
| currency | varchar(10) | YES | | Typically "Rs." |
| freeShippingThreshold | decimal(10,2) | YES | | |
| standardShippingFee | decimal(10,2) | YES | | |
| taxRate | decimal(5,2) | YES | | |
| defaultMetaTitle, defaultMetaDescription | text | YES | | SEO defaults |
| storefrontNavigation, homepageSections, socialLinks | longtext | YES | | JSON configurations |

### Product & Catalog Tables

#### `products`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | varchar(255) | NO | | Primary Key |
| name | varchar(255) | YES | | |
| slug | varchar(255) | YES | | Unique |
| sku, brand, status, productType | varchar | YES | | 'simple' or 'variable' |
| price, originalPrice, weight | decimal(10,2) | YES | | |
| discountPercent, rating | decimal | YES | | |
| reviewCount, stockQuantity, displayOrder | int(11) | YES | | |
| categoryId | varchar(255) | YES | | |
| inStock, trackInventory, isVisible | tinyint(1) | YES | | Booleans |
| isFeatured, isBestseller, isNewArrival | tinyint(1) | YES | | Booleans |
| deliveryType | varchar(50) | YES | | |
| customDeliveryFee | decimal(10,2) | YES | | |
| shortDescription, description, safetyInfo | text | YES | | |
| features, specifications, tags, pricingOffers | longtext | YES | | JSON data |
| defaultAttributes, variants, productDetailBlocks | longtext | YES | | JSON data for complex structures |

#### `categories`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | varchar(255) | NO | | Primary Key |
| name, slug | varchar(255) | YES | | |
| description | text | YES | | |
| parentId | varchar(255) | YES | | FK to `categories(id)` |

#### `product_categories`
Junction table for many-to-many product categorization.
- `product_id` (FK to `products(id)`)
- `category_id` (FK to `categories(id)`)

#### `product_images`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | varchar(255) | NO | | Primary Key |
| product_id | varchar(255) | YES | | FK to `products(id)` |
| url, publicId | varchar | YES | | Cloudinary URLs/IDs |
| isThumbnail | tinyint(1) | YES | | Boolean |
| position | int(11) | YES | | Sort order |

#### `product_variants`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | varchar(255) | NO | | Primary Key |
| product_id | varchar(255) | YES | | FK to `products(id)` |
| sku, stockStatus | varchar | YES | | |
| regularPrice, salePrice, weight | decimal(10,2) | YES | | |
| manageStock, enabled | tinyint(1) | YES | | Booleans |
| stockQuantity | int(11) | YES | | |
| attributes, image | longtext | YES | | JSON |

#### `global_attributes` & `global_attribute_terms`
Manages global product variations (e.g., Size, Color).
- `global_attributes`: `id`, `name`, `slug`, `type`
- `global_attribute_terms`: `id`, `attribute_id` (FK), `name`, `slug`, `value`, `displayOrder`

### Commerce Tables

#### `orders`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | varchar(255) | NO | | Primary Key |
| orderId | varchar(100) | YES | | Human-readable ID (Unique) |
| user_id | varchar(255) | YES | | FK to `users(id)` (if logged in) |
| guestEmail, guestPhone | varchar(255) | YES | | For guest checkouts |
| total, subtotal, shippingFee, discountAmount | decimal(10,2) | YES | | Financials |
| status | varchar(50) | YES | | Pending, Processing, Shipped, etc. |
| paymentMethod | varchar(100) | YES | | e.g. "Cash on Delivery (COD)" |
| shippingAddress, paymentDetails, appliedCoupon | longtext | YES | | JSON |
| trackingNumber | varchar(255) | YES | | |

#### `order_items`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | varchar(255) | NO | | Primary Key |
| order_id | varchar(255) | YES | | FK to `orders(id)` |
| productId, productName | varchar(255) | YES | | |
| quantity | int(11) | YES | | |
| price | decimal(10,2) | YES | | Snapshot of price at checkout |
| image | varchar(500) | YES | | |
| selectedVariant, variationId | varchar | YES | | If variable product |

#### `order_status_history`
Tracks the lifecycle of an order. `order_id` (FK), `status`, `note`, `timestamp`.

#### `bundles` & `bundle_products`
Curated product routines/bundles.
- `bundles`: `id`, `name`, `slug` (Unique), `description`, `image`, `discountPercent`, `isActive`, `displayOrder`
- `bundle_products`: Junction table. `bundle_id` (FK), `product_id` (FK), `quantity`.

#### `coupons`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | varchar(255) | NO | | Primary Key |
| code | varchar(50) | YES | | Unique |
| discountType | varchar(50) | YES | | 'percentage' or 'flat' |
| amount, minSpend | decimal(10,2) | YES | | |
| usageLimit, usedCount | int(11) | YES | 0 | |
| expiryDate | datetime | YES | | |
| isActive | tinyint(1) | YES | 1 | |

### UGC & Support Tables

#### `reviews`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | varchar(255) | NO | | Primary Key |
| productId, productName | varchar(255) | YES | | |
| reviewerName, reviewerEmail | varchar(255) | YES | | |
| rating | int(11) | YES | | 1-5 scale |
| title, content, avatarUrl, imageUrl | varchar/text | YES | | |
| verifiedPurchase | tinyint(1) | YES | | |
| source | varchar(50) | YES | | 'customer' or 'admin' |
| status | varchar(50) | YES | | 'pending', 'approved', 'rejected' |

#### `audio_reviews`
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | varchar(36) | NO | | Primary Key |
| customerName | varchar(255) | NO | | |
| audioUrl | varchar(1000) | NO | | Cloudflare R2 Public URL |
| duration | varchar(10) | NO | 0:00 | e.g. "0:45" |
| displayOrder | int(11) | YES | 0 | |
| isActive | tinyint(1) | YES | 1 | |

#### `contacts`
Customer support contact form submissions.
| Field | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | varchar(255) | NO | | Primary Key |
| name, email, phone | varchar(255) | YES | | |
| subject, message | text | YES | | |
| status | varchar(50) | YES | | 'new', 'read', 'resolved' |

---

## 3. FULL API ENDPOINT LIST

All routes are prefixed by the Express configuration (typically `/api/`).

### Auth & Users (`auth.ts`)
- `POST /register`: Register a new customer. Body: `{ name, email, password }`. Returns: `{ token, user }`.
- `POST /login`: Authenticate a user/admin. Body: `{ email, password }`. Returns: `{ token, user }`.
- `POST /logout`: Invalidate session/token (client-side deletion).
- `GET /me`: *(Auth)* Get current logged-in user profile.
- `POST /wishlist`: *(Auth)* Update user wishlist array. Body: `{ productId }` (toggles).
- `GET /users`: *(Admin)* List all registered users.
- `POST /forgot-password`: Send password reset email. Body: `{ email }`.
- `POST /reset-password`: Reset password using token. Body: `{ token, newPassword }`.
- `POST /change-password`: *(Auth)* Update password from profile. Body: `{ currentPassword, newPassword }`.

### Products (`products.ts`)
- `GET /`: List products (supports query params `?category=slug`, `?q=search`, `?page=1`). Returns: Array of products.
- `POST /`: *(Admin)* Create a new product. Body: Product object.
- `GET /:idOrSlug`: Fetch single product by ID or Slug. Returns: Single product object.
- `GET /:idOrSlug/related`: Fetch related products based on category overlap.
- `PUT /:id`: *(Admin)* Update an existing product.
- `DELETE /:id`: *(Admin)* Delete a product.
- `PUT /reorder`: *(Admin)* Bulk update `displayOrder`. Body: `[{ id, displayOrder }]`.

### Categories (`categories.ts`)
- `GET /`: List all active storefront categories.
- `GET /admin/all`: *(Admin)* List all categories including hidden/draft ones.
- `POST /`: *(Admin)* Create new category. Body: `{ name, slug, description, parentId }`.
- `PUT /:id`: *(Admin)* Update category.
- `DELETE /:id`: *(Admin)* Delete category.

### Orders (`orders.ts`)
- `POST /`: Create an order. Body: `{ items, shippingAddress, paymentMethod, appliedCoupon, etc. }`. Returns: `{ orderId, status }`.
- `GET /`: *(Auth)* Get orders. Customers see their own; Admins see all. 
- `GET /:orderId`: *(Auth)* Get order details by human-readable `orderId`.
- `PUT /:orderId/status`: *(Admin)* Update order status. Body: `{ status, note }`.
- `PUT /:orderId/tracking`: *(Admin)* Update tracking info. Body: `{ trackingNumber }`.
- `DELETE /:orderId`: *(Admin)* Delete an order.

### Audio Reviews (`audioReviews.ts`)
- `GET /`: Fetch all active audio reviews for the frontend slider.
- `GET /admin`: *(Admin)* Fetch all audio reviews (active and inactive).
- `POST /`: *(Admin)* Create an audio review entry. Body: `{ customerName, audioUrl, duration }`.
- `PUT /:id`: *(Admin)* Update entry (name, active status, order).
- `DELETE /:id`: *(Admin)* Delete entry.

### Reviews (`reviews.ts`)
- `GET /product/:productId`: Get approved text reviews for a specific product.
- `POST /`: Submit a new review. Body: `{ productId, rating, title, content, ... }`.
- `GET /admin`: *(Admin)* List all reviews (pending, approved, rejected).
- `POST /admin`: *(Admin)* Submit an admin-authored review.
- `PUT /:id/approve`: *(Admin)* Approve a customer review.
- `PUT /:id/reject`: *(Admin)* Reject a customer review.
- `PUT /:id`: *(Admin)* Edit a review.
- `DELETE /:id`: *(Admin)* Delete a review.

### Bundles (`bundles.ts`)
- `GET /`: List active bundles.
- `GET /:slug`: Get detailed bundle configuration by slug.
- `POST /`: *(Admin)* Create a new bundle. Body: `{ name, discountPercent, products: [{ id, quantity }] }`.
- `PUT /:id`: *(Admin)* Update bundle.
- `DELETE /:id`: *(Admin)* Delete bundle.

### Coupons (`coupons.ts`)
- `GET /`: *(Admin)* List all coupons.
- `POST /validate`: Validate coupon at checkout. Body: `{ code, cartTotal }`. Returns: `{ valid, discountType, amount }`.
- `POST /`: *(Admin)* Create coupon.
- `PUT /:id`: *(Admin)* Update coupon.
- `DELETE /:id`: *(Admin)* Delete coupon.

### Global Attributes (`globalAttributes.ts`)
- `GET /` & `GET /:id`: Fetch global variation attributes (Size, Color, etc).
- `POST /` & `PUT /:id` & `DELETE /:id`: *(Admin)* Manage global attributes.
- `POST /:id/terms` & `PUT /:id/terms/:termId` & `DELETE /:id/terms/:termId`: *(Admin)* Manage individual attribute terms (e.g. "Small", "Medium").

### Contacts (`contact.ts`)
- `POST /`: Submit contact form. Body: `{ name, email, phone, subject, message }`.
- `GET /`: *(Admin)* List all contact messages.
- `PUT /:id/status`: *(Admin)* Update message status (e.g., 'resolved').
- `DELETE /:id`: *(Admin)* Delete a message.

### Settings (`settings.ts`)
- `GET /`: Fetch global store settings (currency, shipping thresholds, navigation config).
- `PUT /`: *(Admin)* Update store settings.
- `PUT /social`: *(Admin)* Update social links.

### Uploads (`upload.ts`)
- `POST /image`, `/category-image`, `/review-image`: *(Admin)* Upload to Cloudinary. Returns URL.
- `DELETE /image`, `/category-image`: *(Admin)* Delete from Cloudinary.

---

## 4. AUTH FLOW

- **Mechanism:** JWT (JSON Web Tokens).
- **Issuance:** A token is generated and returned as a JSON field (`token`) upon successful `/login` or `/register`.
- **Client Duty:** The frontend must store this token (e.g., localStorage or secure cookies) and attach it to subsequent protected requests via the `Authorization` header:
  ```http
  Authorization: Bearer <your_jwt_token_here>
  ```
- **Roles:** The backend checks the JWT payload. 
  - Routes protected by `authenticateToken` middleware require a valid JWT (Customer).
  - Routes protected by `requireAdmin` middleware require the JWT payload to have `role === 'admin'`.

---

## 5. FILE UPLOAD FLOW

### Image Uploads (Cloudinary)
- Admin UI hits `/upload/image` (multipart/form-data).
- Backend pipes the file stream directly to Cloudinary using the API keys from `.env`.
- Cloudinary returns a secure URL and a `public_id`.
- The backend stores this URL string in the MySQL database (e.g., `product_images.url`).

### Audio Uploads (Cloudflare R2)
- Audio files are handled directly by the frontend Admin Panel using `@aws-sdk/client-s3` (bypassing the Node backend to reduce bandwidth).
- The frontend uploads the `.mp3`/`.wav` directly to the Cloudflare R2 bucket.
- The frontend then takes the resulting public R2 URL and sends it to the Node backend via `POST /api/audio-reviews`.
- **Note:** The `.env` variables for R2 credentials are intentionally left blank pending live deployment.

---

## 6. ENVIRONMENT VARIABLES

The backend expects the following environment variables (do not commit actual values to source control):

```env
PORT=5001
JWT_SECRET=

# SMTP Credentials (for Order & Password Emails)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# Used for CORS and email links
FRONTEND_URL=http://localhost:3000

# Cloudinary (Images)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Notification Emails
NEW_ORDER_NOTIFICATION_EMAILS=

# Frontend Next.js On-Demand Revalidation Token
REVALIDATION_SECRET=

# Database
MYSQL_HOST=
MYSQL_DATABASE=
MYSQL_USER=
MYSQL_PASSWORD=

# TikTok / Meta (Optional API Trackers)
META_PIXEL_ID=
ALVORA_META_CAPI_ACCESS_TOKEN=
```

---

## 7. KNOWN QUIRKS & INTEGRATION NOTES

1. **Currency Hardcoding:** Currently, the database stores the currency symbol (e.g., `"Rs."`). Frontend logic typically relies on this setting, but some legacy scripts or dummy data might fallback to strings. Ensure you read `settings.currency`.
2. **JSON Columns in Relational DB:** Complex nested data (like `features`, `tags`, `productDetailBlocks`, `shippingAddress`) are stored in MySQL as `LONGTEXT` strings containing stringified JSON. The backend parses these into JSON arrays/objects before returning them to the client. A new frontend does not need to parse them, it receives them as native JSON.
3. **Variants Duplication:** The system currently stores variants in two places: as a stringified JSON array in `products.variants`, AND as normalized relational rows in the `product_variants` table. When building a new frontend, rely on the backend API response which handles merging these appropriately.
4. **Error Responses:** Standardized error responses are returned as `{ "error": "Message" }` with the appropriate HTTP status code (e.g., 400, 401, 500).
5. **No 400 on Blank R2:** If Cloudflare R2 variables are blank in the frontend `.env`, the frontend gracefully suppresses upload features rather than crashing the backend. Ensure the new frontend replicates this check.
