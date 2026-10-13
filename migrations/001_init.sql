-- LEVA schema only: no seed data or destructive statements.

CREATE TABLE IF NOT EXISTS `users` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  `name` VARCHAR(255),
  `email` VARCHAR(255),
  `passwordHash` VARCHAR(255),
  role VARCHAR(50) DEFAULT 'customer',
  wishlist JSON,
  resetPasswordToken VARCHAR(255),
  resetPasswordExpires DATETIME,
  resetPasswordAttempts INT NOT NULL DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `categories` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  `name` VARCHAR(255),
  `slug` VARCHAR(255),
  `description` TEXT,
  `image` TEXT,
  parentId VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  displayOrder INT DEFAULT 0,
  isFeatured TINYINT(1) DEFAULT 0,
  level INT DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_categories_slug (slug),
  FOREIGN KEY (`parentId`) REFERENCES `categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `products` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  name VARCHAR(255),
  slug VARCHAR(255),
  sku VARCHAR(255),
  price DECIMAL(12,2) DEFAULT 0,
  originalPrice DECIMAL(12,2) DEFAULT 0,
  discountPercent DECIMAL(12,2) DEFAULT 0,
  rating DECIMAL(12,2) DEFAULT 0,
  reviewCount INT DEFAULT 0,
  categoryId VARCHAR(255),
  brand VARCHAR(255),
  inStock TINYINT(1) DEFAULT 1,
  trackInventory TINYINT(1) DEFAULT 0,
  stockQuantity INT DEFAULT 0,
  stockStatus VARCHAR(255),
  lowStockThreshold INT DEFAULT 0,
  isVisible TINYINT(1) DEFAULT 1,
  status VARCHAR(255),
  displayOrder INT DEFAULT 0,
  isFeatured TINYINT(1) DEFAULT 0,
  isBestseller TINYINT(1) DEFAULT 0,
  isNewArrival TINYINT(1) DEFAULT 0,
  isSpotlight TINYINT(1) DEFAULT 0,
  weight DECIMAL(12,2) DEFAULT 0,
  deliveryType VARCHAR(255),
  customDeliveryFee DECIMAL(12,2) DEFAULT 0,
  shortDescription LONGTEXT,
  description LONGTEXT,
  features JSON,
  safetyInfo LONGTEXT,
  specifications JSON,
  tags JSON,
  metaTitle LONGTEXT,
  metaDescription LONGTEXT,
  productDetailBlocks JSON,
  productDetailCustomCss LONGTEXT,
  pricingOffers JSON,
  defaultAttributes JSON,
  defaultVariationId VARCHAR(255),
  productType VARCHAR(255),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  variants JSON,
  UNIQUE KEY uq_products_slug (slug),
  FOREIGN KEY (`categoryId`) REFERENCES `categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `product_images` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  product_id VARCHAR(255) NOT NULL,
  `url` TEXT,
  `publicId` TEXT,
  isThumbnail TINYINT(1) DEFAULT 0,
  position INT DEFAULT 0,
  FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  KEY ix_product_images_position (product_id,position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `product_variants` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  product_id VARCHAR(255) NOT NULL,
  `sku` VARCHAR(255),
  `stockStatus` VARCHAR(255),
  `regularPrice` DECIMAL(12,2),
  `salePrice` DECIMAL(12,2),
  `weight` DECIMAL(12,2),
  `manageStock` TINYINT(1) DEFAULT 1,
  `enabled` TINYINT(1) DEFAULT 1,
  stockQuantity INT DEFAULT 0,
  `attributes` JSON,
  `image` JSON,
  FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `product_categories` (
  product_id VARCHAR(255) NOT NULL,
  category_id VARCHAR(255) NOT NULL,
  PRIMARY KEY (product_id,category_id),
  FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `global_attributes` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  `name` VARCHAR(255),
  `slug` VARCHAR(255),
  `displayType` VARCHAR(255),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attributes_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `global_attribute_terms` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  attribute_id VARCHAR(255) NOT NULL,
  `label` VARCHAR(255),
  `slug` VARCHAR(255),
  `value` VARCHAR(255),
  `colorValue` VARCHAR(255),
  `imageAlt` VARCHAR(255),
  imageUrl TEXT,
  position INT DEFAULT 0,
  FOREIGN KEY (`attribute_id`) REFERENCES `global_attributes` (`id`) ON DELETE CASCADE,
  UNIQUE KEY uq_terms_slug (attribute_id,slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bundles` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  `name` VARCHAR(255),
  `slug` VARCHAR(255),
  `status` VARCHAR(255),
  `description` TEXT,
  `shortDescription` TEXT,
  `image` TEXT,
  `customImage` TEXT,
  `discountPercent` DECIMAL(12,2),
  `bundlePrice` DECIMAL(12,2),
  `discountValue` DECIMAL(12,2),
  `customPrice` DECIMAL(12,2),
  discountType VARCHAR(50) DEFAULT 'percentage',
  isActive TINYINT(1) DEFAULT 1,
  isBestseller TINYINT(1) DEFAULT 0,
  displayOrder INT DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bundles_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bundle_products` (
  bundle_id VARCHAR(255) NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  PRIMARY KEY (bundle_id,product_id),
  FOREIGN KEY (`bundle_id`) REFERENCES `bundles` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bundle_images` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  bundle_id VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  position INT UNSIGNED NOT NULL,
  FOREIGN KEY (`bundle_id`) REFERENCES `bundles` (`id`) ON DELETE CASCADE,
  UNIQUE KEY bundle_image_position (bundle_id,position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `orders` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  orderId VARCHAR(100) NOT NULL,
  checkoutRequestId VARCHAR(120),
  `user_id` VARCHAR(255),
  `guestEmail` VARCHAR(255),
  `guestPhone` VARCHAR(255),
  `trackingNumber` VARCHAR(255),
  `total` DECIMAL(12,2) DEFAULT 0,
  `subtotal` DECIMAL(12,2) DEFAULT 0,
  `shippingFee` DECIMAL(12,2) DEFAULT 0,
  `discountAmount` DECIMAL(12,2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  paymentMethod VARCHAR(100) DEFAULT 'COD',
  `shippingAddress` JSON,
  `paymentDetails` JSON,
  `appliedCoupon` JSON,
  confirmationEmailSentAt DATETIME,
  confirmationEmailAccepted TINYINT(1) DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_orders_order_id (orderId),
  UNIQUE KEY uq_orders_checkout_request (checkoutRequestId),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  KEY ix_orders_status_created (status,createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_items` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  order_id VARCHAR(255) NOT NULL,
  `productId` VARCHAR(255),
  `productName` VARCHAR(255),
  `variationId` VARCHAR(255),
  quantity INT NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  image TEXT,
  selectedVariant TEXT,
  routineComponents JSON,
  FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`variationId`) REFERENCES `product_variants` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_status_history` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  order_id VARCHAR(255) NOT NULL,
  status VARCHAR(50),
  note TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coupons` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  discountType VARCHAR(50),
  `discountValue` DECIMAL(12,2) DEFAULT 0,
  `minPurchase` DECIMAL(12,2) DEFAULT 0,
  isActive TINYINT(1) DEFAULT 1,
  expiryDate DATETIME,
  usageLimit INT,
  usageCount INT NOT NULL DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_coupons_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reviews` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  `productId` VARCHAR(255),
  `productName` VARCHAR(255),
  `reviewerName` VARCHAR(255),
  `reviewerEmail` VARCHAR(255),
  `userId` VARCHAR(255),
  `orderId` VARCHAR(255),
  `approvedBy` VARCHAR(255),
  rating INT,
  `title` TEXT,
  `content` TEXT,
  `avatarUrl` TEXT,
  `imageUrl` TEXT,
  `imagePublicId` TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  source VARCHAR(50) DEFAULT 'customer',
  verifiedPurchase TINYINT(1) DEFAULT 0,
  approvedAt DATETIME,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`productId`) REFERENCES `products` (`id`) ON DELETE SET NULL,
  FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  FOREIGN KEY (`approvedBy`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audio_reviews` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  customerName VARCHAR(255) NOT NULL,
  audioUrl TEXT NOT NULL,
  duration VARCHAR(10) DEFAULT '0:00',
  displayOrder INT DEFAULT 0,
  isActive TINYINT(1) DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `contacts` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  `name` VARCHAR(255),
  `email` VARCHAR(255),
  `phone` VARCHAR(255),
  `subject` TEXT,
  `message` TEXT,
  status VARCHAR(50) DEFAULT 'new',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `settings` (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  `storeName` VARCHAR(255),
  `email` VARCHAR(255),
  `phone` VARCHAR(255),
  address TEXT,
  currency VARCHAR(10),
  `freeShippingThreshold` DECIMAL(12,2),
  `standardShippingFee` DECIMAL(12,2),
  `taxRate` DECIMAL(12,2),
  `defaultMetaTitle` TEXT,
  `defaultMetaDescription` TEXT,
  `storefrontNavigation` JSON,
  `homepageSections` JSON,
  `socialLinks` JSON,
  `adminFeatures` JSON,
  `featureFlags` JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `routine_discount_settings` (
  id TINYINT NOT NULL PRIMARY KEY,
  config JSON,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
