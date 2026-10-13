import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveImage, removeImage, MEDIA_NAME } from '../src/media.js';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wpfl-media-'));
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const WEBP_HDR = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]).toString('base64');

test('saves real images under random names, by their actual bytes', () => {
  const d = dir();
  const a = saveImage(d, `data:image/png;base64,${PNG_1PX}`);
  assert.match(a, MEDIA_NAME);
  assert.ok(a.endsWith('.png') && fs.existsSync(path.join(d, a)));
  // claimed type does not matter, the bytes do
  assert.ok(saveImage(d, `data:image/jpeg;base64,${WEBP_HDR}`).endsWith('.webp'));
  removeImage(d, a);
  assert.ok(!fs.existsSync(path.join(d, a)));
});

test('rejects non-images, other data URLs, oversize files and unsafe names', () => {
  const d = dir();
  assert.throws(() => saveImage(d, 'data:image/svg+xml;base64,PHN2Zz4='), /PNG, JPEG or WebP/);
  assert.throws(() => saveImage(d, `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`), /Not a valid/);
  assert.throws(() => saveImage(d, `data:image/png;base64,${Buffer.alloc(1_600_000).toString('base64')}`), /too large/);
  removeImage(d, '../event.json');   // ignored: not a media name
  assert.equal(fs.readdirSync(d).length, 0);
});
