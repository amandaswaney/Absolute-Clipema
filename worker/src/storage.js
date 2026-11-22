// Saves clip files to Backblaze B2 (through its S3-compatible API), or to a local folder when testing.
import fs from 'node:fs';
import path from 'node:path';
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectVersionsCommand } from '@aws-sdk/client-s3';

export function makeStorage(env = process.env) {
  if (env.STORAGE_DIR) return localStorage(env.STORAGE_DIR, env.STORAGE_PUBLIC_URL || 'http://127.0.0.1:8099');
  const need = ['B2_KEY_ID', 'B2_APP_KEY', 'B2_BUCKET', 'B2_ENDPOINT'];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing Backblaze settings: ${missing.join(', ')}. Add them as GitHub secrets (setup guide, step 5).`);
  const host = env.B2_ENDPOINT.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const region = (host.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/) || [])[1] || 'us-west-004';
  const bucket = env.B2_BUCKET.trim();
  const s3 = new S3Client({
    endpoint: `https://${host}`, region, forcePathStyle: true,
    credentials: { accessKeyId: env.B2_KEY_ID.trim(), secretAccessKey: env.B2_APP_KEY.trim() },
    // B2 does not support the newer checksum headers the AWS SDK adds by default.
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const publicBase = (env.B2_PUBLIC_URL || `https://${host}/${bucket}`).replace(/\/+$/, '');
  const keyId = env.B2_KEY_ID.trim(), appKey = env.B2_APP_KEY.trim();
  return {
    name: 'Backblaze B2',
    // The bucket is private (public buckets need a paid card check). The app reads files with a
    // download pass that lasts 7 days; the robot renews it every few days.
    async downloadAuth() {
      const basic = Buffer.from(`${keyId}:${appKey}`).toString('base64');
      const r = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } });
      if (!r.ok) throw new Error(`Backblaze sign-in failed (HTTP ${r.status}). Check B2_KEY_ID and B2_APP_KEY.`);
      const a = await r.json();
      const st = a.apiInfo.storageApi;
      let bucketId = ((st.allowed && st.allowed.buckets) || []).find((b) => b.name === bucket)?.id;
      if (!bucketId) {
        const lb = await fetch(`${st.apiUrl}/b2api/v3/b2_list_buckets`, { method: 'POST', headers: { Authorization: a.authorizationToken }, body: JSON.stringify({ accountId: a.accountId, bucketName: bucket }) });
        const lj = await lb.json();
        bucketId = lj.buckets && lj.buckets[0] && lj.buckets[0].bucketId;
      }
      if (!bucketId) throw new Error(`Could not find the bucket "${bucket}". Check B2_BUCKET, and that the key is allowed to use it.`);
      const valid = 7 * 24 * 3600;
      const d = await fetch(`${st.apiUrl}/b2api/v3/b2_get_download_authorization`, {
        method: 'POST', headers: { Authorization: a.authorizationToken },
        body: JSON.stringify({ bucketId, fileNamePrefix: 'v/', validDurationInSeconds: valid }),
      });
      if (!d.ok) throw new Error(`Backblaze would not make a download pass (HTTP ${d.status}). The key needs "Read and Write" access.`);
      const dj = await d.json();
      return { base: `${st.downloadUrl}/file/${encodeURIComponent(bucket)}/`, token: dj.authorizationToken, expiresAt: Date.now() + valid * 1000 };
    },
    publicUrl: (key) => `${publicBase}/${key}`,
    async put(key, file, contentType) {
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: fs.readFileSync(file), ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return `${publicBase}/${key}`;
    },
    async remove(key) {
      // B2 keeps old versions; remove them all so the space is really freed.
      try {
        const v = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }));
        const all = [...(v.Versions || []), ...(v.DeleteMarkers || [])].filter((x) => x.Key === key);
        for (const x of all) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: x.VersionId }));
        if (all.length) return;
      } catch { /* key without list permission: fall back to a plain delete */ }
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

function localStorage(dir, base) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    name: 'local folder',
    async downloadAuth() { return { base: `${base}/`, token: 'local-test', expiresAt: Date.now() + 7 * 86400000 }; },
    publicUrl: (key) => `${base}/${key}`,
    async put(key, file) {
      const dest = path.join(dir, key);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file, dest);
      return `${base}/${key}`;
    },
    async remove(key) { fs.rmSync(path.join(dir, key), { force: true }); },
  };
}
