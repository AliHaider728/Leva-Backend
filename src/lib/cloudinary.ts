import { randomUUID } from 'node:crypto';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

export const PRODUCT_IMAGE_FOLDER = 'alvora/products';
export const PRODUCT_THUMBNAIL_FOLDER = `${PRODUCT_IMAGE_FOLDER}/thumbnails`;
export const PRODUCT_DETAIL_IMAGE_FOLDER = `${PRODUCT_IMAGE_FOLDER}/detail-content`;
export const CATEGORY_IMAGE_FOLDER = 'alvora/categories';
export const REVIEW_IMAGE_FOLDER = 'alvora/reviews';

export const hasCloudinaryConfiguration = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (hasCloudinaryConfiguration) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

export const isProductImagePublicId = (publicId: string) =>
  publicId.startsWith(`${PRODUCT_IMAGE_FOLDER}/`) &&
  publicId.length > PRODUCT_IMAGE_FOLDER.length + 1;

export const isProductDetailImagePublicId = (publicId: string) =>
  publicId.startsWith(`${PRODUCT_DETAIL_IMAGE_FOLDER}/`) &&
  publicId.length > PRODUCT_DETAIL_IMAGE_FOLDER.length + 1;

export const isCategoryImagePublicId = (publicId: string) =>
  publicId.startsWith(`${CATEGORY_IMAGE_FOLDER}/`) &&
  publicId.length > CATEGORY_IMAGE_FOLDER.length + 1;

const uploadImageBufferToFolder = (buffer: Buffer, folder: string) =>
  new Promise<{ url: string; publicId: string }>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        asset_folder: folder,
        public_id: `${folder}/${randomUUID()}`,
        unique_filename: false,
        overwrite: false,
        resource_type: 'image'
      },
      (error, result?: UploadApiResponse) => {
        if (error) {
          reject(error);
          return;
        }

        if (!result?.secure_url || !result.public_id) {
          reject(new Error('Cloudinary returned an incomplete upload result'));
          return;
        }

        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );

    uploadStream.end(buffer);
  });

export const uploadProductImage = (file: Express.Multer.File) =>
  uploadImageBufferToFolder(file.buffer, PRODUCT_IMAGE_FOLDER);

export const uploadProductThumbnail = (buffer: Buffer) =>
  uploadImageBufferToFolder(buffer, PRODUCT_THUMBNAIL_FOLDER);

export const uploadProductDetailImage = (file: Express.Multer.File) =>
  uploadImageBufferToFolder(file.buffer, PRODUCT_DETAIL_IMAGE_FOLDER);

export const uploadCategoryImage = (file: Express.Multer.File) =>
  uploadImageBufferToFolder(file.buffer, CATEGORY_IMAGE_FOLDER);

export const uploadReviewImage = (file: Express.Multer.File) =>
  uploadImageBufferToFolder(file.buffer, REVIEW_IMAGE_FOLDER);

export const deleteProductImage = async (publicId: string) => {
  if (!isProductImagePublicId(publicId)) {
    throw new Error('Invalid Alvora product image public ID');
  }

  return cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
    invalidate: true
  });
};

export const deleteProductImages = async (publicIds: string[]) => {
  const uniquePublicIds = [...new Set(publicIds.filter(isProductImagePublicId))];
  const results = await Promise.allSettled(uniquePublicIds.map(deleteProductImage));
  const failedPublicIds = results.flatMap((result, index) =>
    result.status === 'rejected' ? [uniquePublicIds[index]] : []
  );

  if (failedPublicIds.length > 0) {
    console.error(`Cloudinary cleanup failed for ${failedPublicIds.length} product image(s).`);
  }

  return failedPublicIds;
};

export const deleteCategoryImage = async (publicId: string) => {
  if (!isCategoryImagePublicId(publicId)) throw new Error('Invalid Alvora category image public ID');
  return cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
};
