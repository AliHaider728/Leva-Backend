import sharp from 'sharp';

export const PRODUCT_THUMBNAIL_SIZE = 400;

export const createProductImage = (buffer: Buffer) => sharp(buffer)
  .rotate()
  .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
  .webp({ quality: 80 })
  .toBuffer();

export const createProductThumbnail = (buffer: Buffer) =>
  sharp(buffer)
    .rotate()
    .resize(PRODUCT_THUMBNAIL_SIZE, PRODUCT_THUMBNAIL_SIZE, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: 80 })
    .toBuffer();
