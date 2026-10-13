// Event store: one JSON file per event in data/events/<id>.json (atomic,
// debounced writes), plus the archive of past events (data/archive/<id>.json).
// An event is ~20 robots and ~100 fights, so whole-document writes are fine.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { newEvent, standings } from './tournament.js';

export const ARCHIVE_ID = /^[0-9]{8}-[0-9]{6}-[a-z0-9-]{0,40}$/;
export const EVENT_ID = /^e[a-z0-9]{8,24}$/;

// Fill in fields added since a document was written (v1 had a `published`
// flag instead of a status).
export function upgrade(doc) {
  const base = newEvent();
  const d = { ...base, ...doc, event: { ...base.event, ...doc.event } };
  if (!doc.status) d.status = doc.published === false ? 'draft' : 'published';
  delete d.published;
  return d;
}

const newId = () => `e${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.eventsDir = path.join(dataDir, 'events');
    this.archiveDir = path.join(dataDir, 'archive');
    this.events = new Map();
    this.timers = new Map();
    this.loadEvents();
    this.migrateLegacy();
    this.archives = this.scanArchives();
  }

  // ── Events ───────────────────────────────────────────────────────────────
  loadEvents() {
    let files = [];
    try { files = fs.readdirSync(this.eventsDir).filter(f => f.endsWith('.json')); } catch { return; }
    for (const f of files) {
      const id = f.slice(0, -5);
      if (!EVENT_ID.test(id)) continue;
      try {
        const doc = upgrade(JSON.parse(fs.readFileSync(path.join(this.eventsDir, f), 'utf8')));
        doc.id = id;
        this.events.set(id, doc);
      } catch (e) {
        console.error(`[store] ${f} unreadable (${e.message}) — skipped`);
      }
    }
    // Only one event can be live; if files disagree, keep the first.
    for (const d of this.list().filter(x => x.status === 'live').slice(1)) d.status = 'published';
  }

  // v1 kept one current event (event.json) and an upcoming list (site.json).
  // Both become events; the originals are kept as *.migrated.
  migrateLegacy() {
    const legacy = path.join(this.dir, 'event.json');
    if (fs.existsSync(legacy)) {
      try {
        const doc = upgrade(JSON.parse(fs.readFileSync(legacy, 'utf8')));
        if (doc.robots.length || doc.rounds.length) {
          if (doc.rounds.length || doc.live) doc.status = this.liveDoc() ? 'published' : 'live';
          this.add(doc);
          console.info(`[store] migrated event.json → event ${doc.id} (${doc.status})`);
        }
        fs.renameSync(legacy, `${legacy}.migrated`);
      } catch (e) { console.error(`[store] event.json not migrated: ${e.message}`); }
    }
    const site = path.join(this.dir, 'site.json');
    if (fs.existsSync(site)) {
      try {
        for (const u of JSON.parse(fs.readFileSync(site, 'utf8')).upcoming || []) {
          const doc = newEvent();
          const time = /^\d{2}:\d{2}$/.test(u.time || '') ? u.time : '';
          Object.assign(doc.event, { name: u.name, date: u.date, time, location: u.location || '', link: u.link || '',
            note: [u.time && !time ? u.time : '', u.note].filter(Boolean).join(' · '), image: u.image || '',
            startsAt: 0 });   // the server's timezone is not the venue's: the referee sets the time
          doc.status = 'published';
          this.add(doc);
          console.info(`[store] migrated upcoming "${u.name}" → event ${doc.id}`);
        }
        fs.renameSync(site, `${site}.migrated`);
      } catch (e) { console.error(`[store] site.json not migrated: ${e.message}`); }
    }
  }

  get(id) { return this.events.get(id) || null; }
  list() { return [...this.events.values()]; }
  liveDoc() { return this.list().find(d => d.status === 'live') || null; }

  add(doc) {
    doc.id = newId();
    this.events.set(doc.id, doc);
    this.write(doc.id);
    return doc;
  }

  save(id) {
    if (!this.events.has(id)) return;
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => this.write(id), 250));
  }

  write(id) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const doc = this.events.get(id);
    if (doc) writeAtomic(path.join(this.eventsDir, `${id}.json`), doc);
  }

  flush() { for (const id of [...this.timers.keys()]) this.write(id); }

  // Delete = move to events/trash/ (recoverable over SSH).
  removeEvent(id) {
    this.write(id);
    const src = path.join(this.eventsDir, `${id}.json`);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.join(this.eventsDir, 'trash'), { recursive: true });
      fs.renameSync(src, path.join(this.eventsDir, 'trash', `${id}.json`));
    }
    this.events.delete(id);
  }

  // A finished live event becomes a past event.
  archiveEvent(id, now = new Date()) {
    const archived = this.archive({ ...this.get(id), status: 'done' }, now, true);
    this.removeEvent(id);
    return archived;
  }

  // A past event comes back as a draft (results intact, nothing loaded).
  restoreArchive(archiveId) {
    const old = this.readArchive(archiveId);
    if (!old) throw new Error('Unknown past event');
    delete old.archivedAt;
    old.live = null;
    old.status = 'draft';
    return this.add(old);
  }

  // ── Archive ──────────────────────────────────────────────────────────────
  // Nothing worth keeping in an event with no robots and no rounds.
  static isEmpty(doc) { return !doc.robots.length && !doc.rounds.length; }

  // Save `doc` as a past event. Returns its id, or null if it was empty (unless forced).
  archive(doc, now = new Date(), force = false) {
    if (!force && Store.isEmpty(doc)) return null;
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const slug = String(doc.event.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    let id = `${stamp}-${slug}`;
    for (let i = 2; fs.existsSync(path.join(this.archiveDir, id + '.json')); i++) id = `${stamp}-${slug}`.slice(0, 52) + `-${i}`;
    writeAtomic(path.join(this.archiveDir, id + '.json'), { ...doc, archivedAt: now.getTime() });
    this.archives = this.scanArchives();
    return id;
  }

  // "Delete" = move to archive/trash/ (out of every list and link, still recoverable over SSH).
  deleteArchive(id) {
    if (!ARCHIVE_ID.test(String(id))) throw new Error('Unknown past event');
    const src = path.join(this.archiveDir, id + '.json');
    if (!fs.existsSync(src)) throw new Error('Unknown past event');
    const trash = path.join(this.archiveDir, 'trash');
    fs.mkdirSync(trash, { recursive: true });
    fs.renameSync(src, path.join(trash, `${id}.json`));
    this.archives = this.scanArchives();
  }

  // Is a media file still used by any event, past event or trashed one? Then keep it.
  mediaInUse(name) {
    if (this.list().some(d => JSON.stringify(d).includes(name))) return true;
    for (const dir of [this.archiveDir, path.join(this.archiveDir, 'trash'), path.join(this.eventsDir, 'trash')]) {
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }
      if (files.some(f => fs.readFileSync(path.join(dir, f), 'utf8').includes(name))) return true;
    }
    return false;
  }

  readArchive(id) {
    if (!ARCHIVE_ID.test(String(id))) return null;
    try { return upgrade(JSON.parse(fs.readFileSync(path.join(this.archiveDir, id + '.json'), 'utf8'))); }
    catch { return null; }
  }

  // Newest first: [{ id, name, date, archivedAt, robots, fights, rounds, champion, leaders, finished, published }]
  scanArchives() {
    let files = [];
    try { files = fs.readdirSync(this.archiveDir).filter(f => f.endsWith('.json')); } catch { return []; }
    return files.map(f => f.slice(0, -5)).filter(id => ARCHIVE_ID.test(id)).map(id => {
      const doc = this.readArchive(id);
      return doc && { id, ...summarize(doc) };
    }).filter(Boolean).sort((a, b) => b.archivedAt - a.archivedAt);
  }
}

// Who won (or who leads) — for lists of past events.
export function summarize(doc) {
  const st = standings(doc);
  const finished = doc.rounds.length > 0 && doc.rounds.length >= doc.event.rounds &&
                   doc.fights.every(f => f.ranked === false || f.status === 'done');
  const leaders = st.filter(s => s.rank === 1 && s.played + s.byes > 0).map(s => s.name);
  return {
    name: doc.event.name, date: doc.event.date, archivedAt: doc.archivedAt || 0, published: doc.status !== 'draft',
    robots: doc.robots.length, rounds: doc.rounds.length,
    fights: doc.fights.filter(f => f.status === 'done' && f.method !== 'bye').length,
    finished, leaders, champion: finished && leaders.length === 1 ? leaders[0] : null,
  };
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(tmp, file);
}
