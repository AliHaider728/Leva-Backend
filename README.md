# LEVA Backend API (Express + TypeScript + MySQL)

High-performance commerce API for LEVA Pakistan (`https://leva.pk`), deployed at `https://admin.leva.pk`. Built with Node.js, Express, TypeScript, and MySQL, with native Cloudflare R2 media storage and transactional order processing.

---

## 1. Tech Stack

- **Runtime**: Node.js 20+ / 22+ / 24+
- **Language**: TypeScript 5 (Strict Mode)
- **Framework**: Express 4 with modular routers
- **Database**: MySQL 8.x with connection pooling (`mysql2/promise`)
- **Storage**: Cloudflare R2 Object Storage (`@aws-sdk/client-s3`)
- **Image Processing**: Sharp (WebP auto-optimization & thumbnail generation)
- **Email Service**: Nodemailer over SSL/TLS (`mail.leva.pk:465`)
- **Authentication**: JWT signed session tokens stored in secure, HttpOnly cookies
- **Security & Reliability**: Helmet, CORS origin whitelist, IP rate limiting, Zod schema validation, transaction-safe order placement

---

## 2. Directory Structure

```
backend/
├── migrations/             # SQL schemas & seed files
│   ├── schema.sql          # Core table definitions
│   └── seed-leva-products.json # Production product & bundle seed data
├── scripts/                # Database migration & admin provisioning scripts
├── src/
│   ├── config/             # Session cookies, features, store configuration
│   ├── lib/                # Cloudflare R2, image processing, inventory, checkout logic
│   ├── middleware/         # JWT auth, RBAC (admin/super_admin), CORS, rate limiting
│   ├── mysql-lib/          # Direct MySQL transactional queries & connection pool
│   ├── mysql-routes/       # Express route handlers
│   │   ├── auth.ts         # Login, logout, session verification, password reset
│   │   ├── orders.ts       # COD checkout, order status, courier tracking
│   │   ├── products.ts     # Storefront & admin product CRUD
│   │   ├── categories.ts   # Category management
│   │   ├── bundles.ts      # Bundle & ritual deals
│   │   ├── coupons.ts      # Coupon creation & transactional validation
│   │   ├── reviews.ts      # Customer reviews & admin moderation
│   │   ├── settings.ts     # Store contact info, WhatsApp, free delivery threshold
│   │   └── upload.ts       # Cloudflare R2 direct image upload endpoint
│   ├── utils/              # Email templates (order notifications, receipts)
│   └── server.ts           # App bootstrap, route mounting, error handling
├── .env                    # Unified server environment configuration
├── package.json
└── tsconfig.json
```

---

## 3. Database Schema & Architecture

The application connects to MySQL (`tecnosphere_leva`) using connection pooling.

### Core Tables
- `products`: Product master (`id`, `slug`, `name`, `sku`, `price`, `compare_at_price`, `stock`, `is_active`, `description`, `ingredients`, `usage`, `benefit`, `faq`).
- `product_images`: Multiple Cloudflare R2 images per product with `is_primary` and `display_order`.
- `categories` & `product_categories`: Hierarchical category assignments.
- `bundles` & `bundle_products`: Predefined bundles and savings percentages with dynamic component linking.
- `orders` & `order_items`: Order records with unique `checkoutRequestId` constraint, financial breakdown (subtotal, shipping, discount, total), customer contact, shipping address JSON, and `status`.
- `coupons`: Discount codes (percentage or fixed PKR), usage counts, limits, and expiry timestamps.
- `reviews`: Customer reviews with rating (1-5) and approval moderation flag.
- `users`: Admin and customer accounts with bcrypt-hashed credentials and roles (`admin`, `super_admin`, `customer`).
- `settings`: Key-value store configuration, including WhatsApp support number, free shipping threshold, and feature flags.

---

## 4. Key API Routes

### Public Storefront Routes
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/products` | Retrieve active product catalog with images and categories |
| `GET` | `/api/products/:slug` | Retrieve single product details, ingredients, usage, and reviews |
| `GET` | `/api/categories` | Retrieve all active product categories |
| `GET` | `/api/bundles` | Retrieve active bundles with included items and discounts |
| `POST` | `/api/orders` | Place Cash on Delivery order (atomically validates prices & stock) |
| `GET` | `/api/orders/track` | Track order by `orderId` (`LEV-xxxxxx`) and phone number |
| `POST` | `/api/coupons/validate` | Transactionally test a coupon against cart items |
| `GET` | `/api/settings` | Public store configuration (contacts, delivery rules) |

### Administrative Routes (Requires Admin Cookie Session)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Authenticate admin user and issue secure HttpOnly cookie |
| `POST` | `/api/auth/logout` | Clear authentication cookie |
| `GET` | `/api/auth/me` | Fetch currently logged-in account details |
| `GET` | `/api/orders` | Paginated orders list with search (phone, name, order ID) and status filter |
| `PUT` | `/api/orders/:id/status` | Update order state (`pending`, `confirmed`, `processing`, `shipped`, `delivered`, `cancelled`) |
| `PUT` | `/api/orders/:id/tracking` | Assign courier tracking number |
| `POST` | `/api/products` | Create product with SKU, prices, stock, and R2 images |
| `PUT` | `/api/products/:id` | Update product details and inventory |
| `POST` | `/api/bundles` | Create/update product bundles |
| `POST` | `/api/coupons` | Create discount coupon |
| `PUT` | `/api/reviews/:id/approve` | Approve/reject customer reviews |
| `POST` | `/api/upload/image` | Upload image buffer directly to Cloudflare R2; returns public CDN URL |
| `PUT` | `/api/settings` | Update store settings and feature flags |

---

## 5. Security & Order Integrity

1. **Server-Authoritative Pricing**: All item prices, bundle discounts, shipping fees, and coupon calculations are computed strictly from database records inside a database transaction. Any price or total sent by the client is discarded.
2. **Idempotent Order Creation**: `checkoutRequestId` guarantees network retries or double clicks cannot create duplicate orders or deduct inventory twice.
3. **Atomic Stock Decrement & Rollback**: When an order is placed, inventory is decremented atomically. If insertion fails at any point, the entire transaction rolls back.
4. **Order Cancellation Handling**: If an order is cancelled by admin, component snapshots restore the exact quantities back into available inventory.
5. **Automated Email Notifications**: Uses Nodemailer with TLS to immediately dispatch HTML confirmation emails to the customer and alert the operations team (`sales@leva.pk`).

---

## 6. Cloudflare R2 Storage Configuration

Image uploads through `/api/upload/image` process images with Sharp to WebP format and upload directly to Cloudflare R2:
- **Bucket**: `leva-skincare`
- **CDN Base**: `https://pub-a072adc556d047e0bacc05300ca63f83.r2.dev`

---

## 7. Environment Configuration

All configuration is consolidated into a single `.env` file:

```env
PORT=5001
JWT_SECRET=your-secure-jwt-secret

# Frontend Origins (CORS)
FRONTEND_URL=https://leva.pk

# Database (MySQL)
LEVA_MYSQL_HOST=195.201.164.48
LEVA_MYSQL_DATABASE=tecnosphere_leva
LEVA_MYSQL_USER=tecnosphere_leva
LEVA_MYSQL_PASSWORD=your-mysql-password

# Email (SMTP)
SMTP_HOST=mail.leva.pk
SMTP_PORT=465
SMTP_USER=sales@leva.pk
SMTP_PASS=your-smtp-password
SMTP_FROM="LEVA <sales@leva.pk>"
SUPPORT_EMAIL=sales@leva.pk
NEW_ORDER_NOTIFICATION_EMAILS=sales@leva.pk,abraransarise@gmail.com,levaskincare01@gmail.com

# Cloudflare R2 Object Storage
R2_ACCOUNT_ID=081607919084e8232f264f5c72fd51a5
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET_NAME=leva-skincare
R2_ENDPOINT=https://081607919084e8232f264f5c72fd51a5.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://pub-a072adc556d047e0bacc05300ca63f83.r2.dev

# Google Analytics
GA_MEASUREMENT_ID=G-5ELNQLZJB0
```

---

## 8. Development & Deployment

### Run Locally
```bash
npm install
npm run dev
```

### Production Build
```bash
npm run build
npm start
```

### Git Repository
- GitHub: `https://github.com/AliHaider728/Leva-Backend.git` (Branch: `main`)
