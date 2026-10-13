// Uploaded images (upcoming-event banners): data/media/<random>.<ext>.
// The referee's browser resizes before upload; here we only accept real
// PNG/JPEG/WebP bytes (checked by magic number, not by the claimed type).
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_IMAGE_BYTES = 1_500_000;
export const MEDIA_NAME = /^[a-f0-9]{24}\.(webp|jpg|png)$/;
export const MEDIA_TYPES = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };

function sniff(buf) {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

// data:image/...;base64,... → saved file name. Throws on anything else.
export function saveImage(dir, dataUrl) {
  const m = /^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Expected a PNG, JPEG or WebP image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('Image too large (max 1.5 MB after resizing)');
  const ext = sniff(buf);
  if (!ext) throw new Error('Not a valid PNG, JPEG or WebP image');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return name;
}

export function removeImage(dir, name) {
  if (name && MEDIA_NAME.test(name)) fs.rmSync(path.join(dir, name), { force: true });
}
