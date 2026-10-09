import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import {
  deleteCategoryImage,
  deleteProductImage,
  hasCloudinaryConfiguration,
  uploadProductDetailImage,
  uploadProductImage,
  uploadProductThumbnail,
  uploadCategoryImage,
  uploadReviewImage
} from '../lib/cloudinary.js';
import { uploadToR2, deleteFromR2 } from '../lib/r2.js';
import { createProductImage, createProductThumbnail } from '../lib/productImages.js';
import { createHash } from 'crypto';
import { pool } from '../mysql-lib/db.js';
const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (_req, file, cb) => {
    const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (acceptedTypes.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, WEBP) are allowed'));
    }
  }
});

const requireCloudinaryConfiguration = (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!hasCloudinaryConfiguration) {
    return res.status(503).json({
      error:
        'Image uploads are unavailable because Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
    });
  }

  next();
};

// POST Upload Single Image
router.post(
  '/image',
  authenticateToken,
  requireAdmin,
  upload.single('image'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    try {
      const [imageBuffer, thumbnailBuffer] = await Promise.all([createProductImage(req.file.buffer), createProductThumbnail(req.file.buffer)]);
      const key = createHash('sha256').update(imageBuffer).update(thumbnailBuffer).digest('hex');
      const originalFilename = `products/optimized/${key}.webp`;
      const thumbnailFilename = `products/optimized/thumb-${key}.webp`;

      // Upload both to R2
      const url = await uploadToR2(imageBuffer, originalFilename, 'image/webp');
      const thumbnailUrl = await uploadToR2(thumbnailBuffer, thumbnailFilename, 'image/webp');

      res.json({
        url: url,
        secureUrl: url,
        publicId: originalFilename,
        thumbnailUrl: thumbnailUrl,
        thumbnailSecureUrl: thumbnailUrl,
        thumbnailPublicId: thumbnailFilename,
        filename: originalFilename,
        mimetype: 'image/webp',
        size: imageBuffer.length
      });
    } catch (err: any) {
      console.error('R2 image upload failed:', err);
      res.status(502).json({ error: `R2 image upload failed: ${err.message || String(err)}` });
    }
  }
);

router.post(
  '/category-image',
  authenticateToken,
  requireSuperAdmin,
  requireCloudinaryConfiguration,
  upload.single('image'),
  async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });
    try {
      const result = await uploadCategoryImage(req.file);
      res.json({ secureUrl: result.url, url: result.url, publicId: result.publicId });
    } catch {
      console.error('Cloudinary category image upload failed.');
      res.status(502).json({ error: 'Cloudinary category image upload failed' });
    }
  }
);

router.post(
  '/review-image',
  authenticateToken,
  requireAdmin,
  requireCloudinaryConfiguration,
  upload.single('image'),
  async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });
    try {
      const result = await uploadReviewImage(req.file);
      res.json({ secureUrl: result.url, url: result.url, publicId: result.publicId });
    } catch {
      console.error('Cloudinary review image upload failed.');
      res.status(502).json({ error: 'Cloudinary review image upload failed' });
    }
  }
);

router.delete(
  '/category-image',
  authenticateToken,
  requireSuperAdmin,
  requireCloudinaryConfiguration,
  async (req: Request, res: Response) => {
    const publicId = typeof req.body?.publicId === 'string' ? req.body.publicId.trim() : '';
    if (!publicId) return res.status(400).json({ error: 'Cloudinary public ID is required' });
    try {
      const [rows] = await pool.execute('SELECT id FROM categories WHERE imagePublicId = ?', [publicId]);
      if ((rows as any[]).length > 0) {
        return res.status(409).json({ error: 'This image is attached to a saved category.' });
      }
      const result = await deleteCategoryImage(publicId);
      if (!['ok', 'not found'].includes(result.result)) {
        return res.status(502).json({ error: 'Cloudinary did not confirm image deletion' });
      }
      res.json({ deleted: true });
    } catch (error) {
      console.error('Cloudinary category image deletion failed.');
      const message = error instanceof Error && error.message.startsWith('Invalid Alvora')
        ? error.message
        : 'Cloudinary category image deletion failed';
      res.status(message.startsWith('Invalid') ? 400 : 502).json({ error: message });
    }
  }
);

// POST a product-detail content image into its dedicated Cloudinary folder
router.post(
  '/detail-content-image',
  authenticateToken,
  requireAdmin,
  requireCloudinaryConfiguration,
  upload.single('image'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    try {
      const result = await uploadProductDetailImage(req.file);
      res.json({
        url: result.url,
        secureUrl: result.url,
        publicId: result.publicId,
        mimetype: req.file.mimetype,
        size: req.file.size
      });
    } catch {
      console.error('Cloudinary product-detail image upload failed.');
      res.status(502).json({ error: 'Cloudinary image upload failed' });
    }
  }
);

// DELETE a newly uploaded image that was discarded before the product was saved
router.delete(
  '/image',
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    const publicId = typeof req.body?.publicId === 'string' ? req.body.publicId.trim() : '';
    if (!publicId) return res.status(400).json({ error: 'Image public ID is required' });
    if (!/^products\/[a-zA-Z0-9_./-]+$/.test(publicId) || publicId.includes('..')) {
      return res.status(400).json({ error: 'Invalid image public ID' });
    }

    try {
      const originalId = publicId.replace(/\/thumb-([^/]+)$/, '/$1');
      const thumbId = originalId.replace(/\/([^/]+)$/, '/thumb-$1');
      const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
      const urls = [`${base}/${originalId}`, `${base}/${thumbId}`];
      const [pRows] = await pool.execute('SELECT id FROM product_images WHERE publicId IN (?, ?) OR url IN (?, ?) LIMIT 1', [originalId, thumbId, ...urls]);
      const [bRows] = await pool.execute('SELECT id FROM bundles WHERE image IN (?, ?) OR customImage IN (?, ?) LIMIT 1', [...urls, ...urls]);
      const [gRows] = await pool.execute('SELECT id FROM bundle_images WHERE url IN (?, ?) LIMIT 1', urls);
      const [vRows] = await pool.execute("SELECT id FROM product_variants WHERE JSON_UNQUOTE(JSON_EXTRACT(image, '$.url')) IN (?, ?) LIMIT 1", urls);
      if ([pRows, bRows, gRows, vRows].some(rows => (rows as any[]).length > 0)) {
        return res.status(409).json({
          error: 'This image is attached to a saved product or bundle and must be removed through its editor.'
        });
      }
      
      await deleteFromR2(originalId);
      
      // Also attempt to delete the thumbnail if it exists
      if (thumbId !== originalId) {
        try {
          await deleteFromR2(thumbId);
        } catch (e) {
          console.error('Thumbnail deletion failed (might not exist):', e);
        }
      }

      res.json({ deleted: true });
    } catch (error) {
      console.error('R2 image deletion failed:', error);
      res.status(502).json({ error: 'R2 image deletion failed' });
    }
  }
);

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: error.code === 'LIMIT_FILE_SIZE' ? 'Image exceeds the 5MB size limit' : error.message
    });
  }
  if (error instanceof Error && error.message.startsWith('Only image files')) {
    return res.status(400).json({ error: error.message });
  }
  next(error);
});

export default router;

