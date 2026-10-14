import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Rules, OLD_NAME } from '../src/rules.js';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wpfl-rules-'));
const pdf = text => `data:application/pdf;base64,${Buffer.from(`%PDF-1.7\n${text}\n%%EOF`).toString('base64')}`;

test('seeds from the repo copy once, then keeps what referees uploaded', () => {
  const d = dir(), seed = path.join(d, 'seed.pdf');
  fs.writeFileSync(seed, '%PDF-1.7 seed');
  const r = new Rules(path.join(d, 'rules'), seed);
  assert.equal(r.info().name, 'seed.pdf');
  assert.equal(fs.readFileSync(r.file(), 'utf8'), '%PDF-1.7 seed');
  r.save(pdf('rev 5'), 'Rules V5.pdf');
  const again = new Rules(path.join(d, 'rules'), seed);
  assert.equal(again.info().name, 'Rules V5.pdf');
  assert.match(fs.readFileSync(again.file(), 'utf8'), /rev 5/);
});

test('no seed, no upload: nothing to serve', () => {
  const r = new Rules(path.join(dir(), 'rules'));
  assert.equal(r.info(), null);
  assert.equal(r.file(), null);
});

test('upload replaces current and keeps the old one (newest first, capped)', () => {
  const r = new Rules(path.join(dir(), 'rules'));
  r.save(pdf('v1'), 'v1.pdf');
  r.meta.at -= 1000;   // distinct timestamps for the old-file names
  r.save(pdf('v2'), 'v2.pdf');
  const old = r.info().old;
  assert.equal(old.length, 1);
  assert.match(old[0].file, OLD_NAME);
  assert.match(fs.readFileSync(r.file(old[0].file), 'utf8'), /v1/);
  for (let i = 3; i < 15; i++) { r.meta.at -= 1000 * i; r.save(pdf(`v${i}`), `v${i}.pdf`); }
  assert.equal(r.info().old.length, 10);
});

test('rejects non-PDFs, oversize files, repeats and unsafe names', () => {
  const r = new Rules(path.join(dir(), 'rules'));
  assert.throws(() => r.save('data:image/png;base64,AAAA', 'x.png'), /Expected a PDF/);
  assert.throws(() => r.save(`data:application/pdf;base64,${Buffer.from('<html>').toString('base64')}`), /Not a valid PDF/);
  assert.throws(() => r.save(`data:application/pdf;base64,${Buffer.alloc(3_100_000).toString('base64')}`), /too large/);
  r.save(pdf('same'), '../../etc/"evil"\r\n.pdf');
  assert.doesNotMatch(r.info().name, /[/"\r\n]/);
  assert.throws(() => r.save(pdf('same'), 'again.pdf'), /same file/);
  assert.equal(r.file('../current.json'), null);
  assert.equal(r.file('20260101-000000-zzzzzzzz.pdf'), null);
});
