const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

// Upload a file. virtualBucket acts as a path prefix (e.g. "post-images").
// Returns the public URL string.
async function uploadFile(virtualBucket, filePath, buffer, contentType) {
  const key = `${virtualBucket}/${filePath}`;
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
  return `${PUBLIC_URL}/${key}`;
}

// Build a public URL without making a network call.
function getPublicUrl(virtualBucket, filePath) {
  return `${PUBLIC_URL}/${virtualBucket}/${filePath}`;
}

// Delete a file. Errors are logged but not re-thrown unless critical.
async function deleteFile(virtualBucket, filePath) {
  const key = `${virtualBucket}/${filePath}`;
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// Generate a presigned PUT URL for direct client-to-R2 uploads.
// Returns { signedUrl, key } where key is the full R2 object key.
async function createPresignedUploadUrl(
  virtualBucket,
  filePath,
  contentType,
  expiresIn = 3600,
) {
  const key = `${virtualBucket}/${filePath}`;
  const signedUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn },
  );
  return { signedUrl, key };
}

module.exports = { uploadFile, getPublicUrl, deleteFile, createPresignedUploadUrl };
