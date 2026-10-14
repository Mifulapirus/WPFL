// Contest rules PDF, served at /rules (wpfl.thehomelab.dev/rules proxies to it).
//   data/rules/current.pdf + current.json   the one being served (name, size, sha256, upload time)
//   data/rules/old/<time>-<sha>.pdf         replaced versions, newest MAX_OLD kept
// First start with nothing uploaded: seed/WPFL-rules.pdf from the repo becomes current.
// Referees replace it from the Event tab; we only accept real PDF bytes.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_PDF_BYTES = 3_000_000;
export const OLD_NAME = /^\d{8}-\d{6}-[a-f0-9]{8}\.pdf$/;
const MAX_OLD = 10;

const stamp = t => new Date(t).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
// Keep a readable file name for downloads; nothing that could break a header.
const cleanName = n => String(n || '').replace(/[^\w.() -]+/g, '_').replace(/^[ ._]+/, '').slice(0, 80) || 'rules.pdf';

export class Rules {
  constructor(dir, seed = null) {
    this.dir = dir;
    this.oldDir = path.join(dir, 'old');
    this.pdf = path.join(dir, 'current.pdf');
    this.metaFile = path.join(dir, 'current.json');
    fs.mkdirSync(this.oldDir, { recursive: true });
    this.meta = null;
    try { this.meta = JSON.parse(fs.readFileSync(this.metaFile, 'utf8')); } catch {}
    if (!this.meta && !fs.existsSync(this.pdf) && seed && fs.existsSync(seed)) {
      this.write(fs.readFileSync(seed), path.basename(seed), fs.statSync(seed).mtimeMs);
    }
  }

  // data:application/pdf;base64,... from the referee page → becomes current. Returns the new info.
  save(dataUrl, name) {
    const m = /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new Error('Expected a PDF file');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > MAX_PDF_BYTES) throw new Error('PDF too large (max 3 MB)');
    if (buf.toString('latin1', 0, 5) !== '%PDF-') throw new Error('Not a valid PDF');
    if (this.meta && crypto.createHash('sha256').update(buf).digest('hex') === this.meta.sha256) {
      throw new Error('That is the same file as the current rules');
    }
    if (fs.existsSync(this.pdf)) {
      const t = this.meta?.at || fs.statSync(this.pdf).mtimeMs;
      fs.renameSync(this.pdf, path.join(this.oldDir, `${stamp(t)}-${(this.meta?.sha256 || '00000000').slice(0, 8)}.pdf`));
      this.prune();
    }
    return this.write(buf, name, Date.now());
  }

  write(buf, name, at) {
    const tmp = this.pdf + '.tmp';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, this.pdf);
    this.meta = { name: cleanName(name), size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
                  at: Math.round(at) };
    fs.writeFileSync(this.metaFile, JSON.stringify(this.meta, null, 2));
    return this.info();
  }

  prune() {
    for (const f of this.old().slice(MAX_OLD)) fs.rmSync(path.join(this.oldDir, f.file), { force: true });
  }

  // Replaced versions, newest first.
  old() {
    return fs.readdirSync(this.oldDir).filter(f => OLD_NAME.test(f)).sort().reverse()
      .map(file => ({ file, size: fs.statSync(path.join(this.oldDir, file)).size }));
  }

  info() {
    return this.meta && { ...this.meta, old: this.old() };
  }

  // Absolute path of a file to serve, or null: '' = current, else a name from old().
  file(oldName = '') {
    if (!oldName) return this.meta && fs.existsSync(this.pdf) ? this.pdf : null;
    return OLD_NAME.test(oldName) && fs.existsSync(path.join(this.oldDir, oldName)) ? path.join(this.oldDir, oldName) : null;
  }
}
