import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const endpoint = process.env.R2_ENDPOINT;

const customHandler = new NodeHttpHandler({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false, // Bypass strict SSL handshake failure for Cloudflare R2
  }),
});

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: endpoint || `https://${accountId}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: accessKeyId || '',
    secretAccessKey: secretAccessKey || '',
  },
  requestHandler: customHandler,
});

export const uploadToR2 = async (
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string> => {
  const bucketName = process.env.R2_BUCKET_NAME || 'alvora-assets';
  const publicUrlBase = process.env.R2_PUBLIC_URL || '';

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: fileBuffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  });

  await r2Client.send(command);
  return `${publicUrlBase}/${fileName}`;
};

export const deleteFromR2 = async (fileName: string): Promise<void> => {
  const bucketName = process.env.R2_BUCKET_NAME || 'alvora-assets';
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: fileName,
  });
  await r2Client.send(command);
};
