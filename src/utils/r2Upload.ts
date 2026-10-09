import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';
import dotenv from 'dotenv';
dotenv.config();

let s3Client: S3Client | null = null;

if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
  const customHandler = new NodeHttpHandler({
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
  });

  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestHandler: customHandler,
  });
}

export const r2Upload = async (buffer: Buffer, originalName: string, mimeType: string): Promise<string> => {
  if (!s3Client) {
    throw new Error('R2_CREDENTIALS_MISSING');
  }

  const bucketName = process.env.R2_BUCKET_NAME || 'alvora-audio';
  const publicUrlBase = process.env.R2_PUBLIC_URL || '';

  const ext = originalName.split('.').pop();
  const filename = `audio_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: filename,
    Body: buffer,
    ContentType: mimeType,
  });

  await s3Client.send(command);

  return publicUrlBase ? `${publicUrlBase.replace(/\/$/, '')}/${filename}` : `https://${bucketName}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${filename}`;
};

export const r2Delete = async (fileUrl: string): Promise<void> => {
  if (!s3Client) return;

  const bucketName = process.env.R2_BUCKET_NAME || 'alvora-audio';
  try {
    const url = new URL(fileUrl);
    const key = url.pathname.replace(/^\//, '');
    
    if (key) {
      const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      });
      await s3Client.send(command);
    }
  } catch (error) {
    console.error('Failed to delete file from R2:', error);
  }
};
