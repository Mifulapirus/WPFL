// WPFL Match Tracker — HTTP + WebSocket server.
//   /            public viewer: the live event, or the next upcoming one (countdown, robots)
//   /ref         referee console (password protected)
//   /obs/*       broadcast graphics for OBS browser sources (fight bar, bracket, ranking)
//   /ws          browser WebSocket: everyone gets state; referees can send commands
//   /led         arena LED driver uplink (Bearer LED_KEY)
//   /api/archive past events (list, read-only view, referee export)
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
//
// EVENTS  draft ──publish──► published ──start──► live ──end──► past (archive)
//           ◄──unpublish──      ◄──back to upcoming──
// Every event holds everything (info, banner, settings, robots, bracket). Only
// one event is live at a time; the fight console and the arena lights run it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { loadConfig } from './src/config.js';
import { Store } from './src/store.js';
import { LedLink } from './src/led.js';
import { LiveFight, LED } from './src/live.js';
import { Auth } from './src/auth.js';
import * as T from './src/tournament.js';
import { importRobots, fetchSheet } from './src/importer.js';
import { saveImage, removeImage, MEDIA_NAME, MEDIA_TYPES } from './src/media.js';

const cfg = loadConfig();
const store = new Store(cfg.dataDir);
const mediaDir = path.join(cfg.dataDir, 'media');
const led = new LedLink({ key: cfg.ledKey });
const auth = new Auth({ password: cfg.refereePassword, secret: cfg.sessionSecret, hours: cfg.sessionHours,
                        trustProxy: cfg.trustProxy });
// The fight controller always works on whichever event is live.
const live = new LiveFight({
  store: { get doc() { return store.liveDoc(); } },
  led,
  onChange: () => { store.save(store.liveDoc()?.id); broadcast(); },
});

// A (re)connected driver gets the lights for whatever is happening right now.
led.on('connected', () => { for (const c of live.scene()) led.send(c); });
led.on('change', () => broadcast());
setInterval(() => live.tick(), 100).unref();

// ── State for clients ─────────────────────────────────────────────────────
// Fingerprint of the page files: open pages reload themselves when a deploy changes it.
const BUILD = (function hashDir(dir, h = crypto.createHash('sha1')) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) hashDir(p, h); else h.update(f.name).update(fs.readFileSync(p));
  }
  return h;
})(path.join(cfg.root, 'public')).digest('hex').slice(0, 12);

// What an event looks like to viewers (robots through the public allow-list).
function eventState(d, now) {
  return {
    id: d.id,
    status: d.status,
    event: d.event,
    robots: d.robots.map(T.publicRobot),   // notes, rules checklist etc. stay private
    rounds: d.rounds,
    fights: d.fights,
    standings: T.standings(d),
    queue: T.queue(d, now),
    live: d.status === 'live' ? live.snapshot(now) : null,
  };
}

const eventInfo = d => ({ id: d.id, status: d.status, ...d.event, robots: d.robots.length });
// Soonest first by date + time as entered (undated events last).
const when = d => `${d.event.date || '9999-99-99'} ${d.event.time || '00:00'}`;
const soonest = (a, b) => when(a).localeCompare(when(b)) || a.event.name.localeCompare(b.event.name);
const publicArchives = () => store.archives.filter(a => a.published !== false);

// Viewers: the live event if there is one, otherwise the next published event.
// Drafts are never sent. Enforced here, not in the page.
function publicState(now) {
  const upcoming = store.list().filter(d => d.status === 'published').sort(soonest);
  const common = { upcoming: upcoming.map(eventInfo), archives: publicArchives() };
  const liveDoc = store.liveDoc();
  if (liveDoc) return { mode: 'live', ...eventState(liveDoc, now), ...common };
  return { mode: 'upcoming', next: upcoming[0] ? eventState(upcoming[0], now) : null, ...common };
}

// Referees: every event in full, plus all past events.
function refState(now) {
  const list = store.list().sort((a, b) => (b.status === 'live') - (a.status === 'live') || soonest(a, b));
  return {
    type: 'state', serverNow: now, build: BUILD, ref: true, led: led.info(),
    data: {
      liveId: store.liveDoc()?.id || null,
      events: list.map(eventInfo),
      byId: Object.fromEntries(list.map(d => [d.id, { ...eventState(d, now), robots: d.robots, importInfo: d.importInfo || null }])),
      archives: store.archives,
    },
  };
}

// A past event in the same shape as a live one (read-only, nothing running).
function archiveState(d) {
  return { mode: 'live', ...eventState({ ...d, status: 'done' }, Date.now()), queue: [], upcoming: [], archives: [],
           archivedAt: d.archivedAt };
}

const clients = new Set();   // { ws, ref }
let broadcastQueued = false;

// Coalesced: many changes in one tick → one push.
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(flushBroadcast);
}

function flushBroadcast() {
  if (!broadcastQueued) return;
  broadcastQueued = false;
  const now = Date.now();
  let pubMsg, refMsg;
  for (const c of clients) {
    if (c.ws.readyState !== 1) continue;
    if (c.ref) c.ws.send(refMsg ??= JSON.stringify(refState(now)));
    else c.ws.send(pubMsg ??= JSON.stringify({ type: 'state', serverNow: now, build: BUILD, data: publicState(now) }));
  }
}

// LED link details (RTT, heap…) change quietly; refresh referees every 5 s.
setInterval(() => {
  const msg = JSON.stringify(refState(Date.now()));
  for (const c of clients) if (c.ref && c.ws.readyState === 1) c.ws.send(msg);
}, 5000).unref();

// ── Referee commands ──────────────────────────────────────────────────────
const fail = m => { throw new Error(m); };
const SCENES = {
  idle: LED.idle, ready: LED.ready, fight: () => LED.fight(led.fightColor), pause: LED.pause, stop: LED.stop,
  off: () => [{ type: 'off', label: 'off' }], white: () => [{ type: 'solid', color: 'white', label: 'white' }],
};

// Delete an uploaded file unless an event or past event still shows it.
const dropMedia = name => { if (name && !store.mediaInUse(name)) removeImage(mediaDir, name); };
const notLive = (d, id) => { if (d.live?.fightId === id) fail('That fight is loaded — use the fight console'); };

// Status changes. Returns a result for the referee (e.g. the archive id).
function setStatus(d, to) {
  const from = d.status, other = store.liveDoc();
  if (from === to) return;
  if (to === 'live') {
    if (other && other !== d) fail(`"${other.event.name}" is live — end it first`);
    d.status = 'live';
    live.lights(LED.idle());
  } else if (from === 'live') {
    if (live.inProgress()) fail('A fight is in progress — end or unload it first');
    d.live = null;
    live.lights(LED.idle());
    if (to === 'done') {
      const archived = store.archiveEvent(d.id);
      console.info(`[event] "${d.event.name}" ended → past event ${archived}`);
      return { archived };
    }
    d.status = to;
  } else if (to === 'draft' || to === 'published') {
    d.status = to;
  } else {
    fail('Unknown status');
  }
  console.info(`[event] "${d.event.name}": ${from} → ${d.status}`);
}

// Commands on the event a referee is working on (args.ev). Persisted + broadcast.
const EVENT = {
  'event.update':   (a, d) => T.updateEvent(d, a),
  'event.status':   (a, d) => setStatus(d, a.status),
  'event.delete':   (a, d) => {
    if (d.status === 'live') fail('End the event first');
    store.removeEvent(d.id);
    console.info(`[event] "${d.event.name}" deleted (events/trash)`);
  },
  // Banner/art: data URL (resized in the referee's browser), or null to remove.
  'event.image':    (a, d) => {
    const old = d.event.image;
    d.event.image = a.data ? saveImage(mediaDir, a.data) : '';
    if (old !== d.event.image) dropMedia(old);
    return { image: d.event.image };
  },
  'robot.add':      (a, d) => T.addRobot(d, a),
  'robot.update':   (a, d) => T.updateRobot(d, a),
  'robot.remove':   (a, d) => {
    const r = T.robotById(d, a.id);
    T.removeRobot(d, a.id);
    dropMedia(r?.photo); dropMedia(r?.photo2);
  },
  // Battlecard picture (front `photo`, or back `photo2`): data URL, or null to remove.
  'robot.photo':    (a, d) => {
    const r = T.robotById(d, a.id) || fail('Unknown robot');
    const slot = a.slot === 'photo2' ? 'photo2' : 'photo';
    const old = r[slot];
    r[slot] = a.data ? saveImage(mediaDir, a.data) : '';
    if (old !== r[slot]) dropMedia(old);
    return { [slot]: r[slot] };
  },
  'robots.copyFrom': (a, d) => {
    const src = store.get(a.from);
    if (!src || src === d) fail('Pick another event to copy from');
    if (!d.importInfo?.url && src.importInfo?.url) d.importInfo = { ...src.importInfo };   // same registration sheet
    return T.copyRobots(d, src);
  },
  // Registrations: a Google Sheets link (fetched here; remembered for re-sync) or pasted/uploaded CSV text.
  'robots.import':  async (a, d) => {
    const url = a.url ? String(a.url).trim() : '';
    const csv = url ? await fetchSheet(url) : String(a.csv || '');
    if (!csv.trim()) fail('Give a Google Sheets link or a CSV file');
    const summary = importRobots(d, csv);
    d.importInfo = { url: url || d.importInfo?.url || '', at: Date.now(),
                     added: summary.added.length, updated: summary.updated.length, skipped: summary.skipped.length };
    console.info(`[import] "${d.event.name}": ${summary.added.length} added, ${summary.updated.length} updated`);
    return summary;
  },
  'round.generate': (a, d) => T.generateRound(d),
  'round.delete':   (a, d) => T.deleteRound(d, Number(a.n)),
  'fight.add':      (a, d) => T.addFight(d, a),
  'fight.update':   (a, d) => T.updateFight(d, a),
  'fight.swap':     (a, d) => { notLive(d, a.id); T.swapCorners(d, a.id); },
  'fight.move':     (a, d) => T.moveFight(d, a.id, Number(a.dir)),
  'fight.remove':   (a, d) => T.removeFight(d, a.id),
  'fight.result':   (a, d) => { notLive(d, a.id); T.setResult(d, a); },
  'fight.reset':    (a, d) => T.resetResult(d, a.id),
  'robot.resetResults': (a, d) => ({ cleared: T.resetRobotResults(d, a.id) }),
  'results.resetAll':   (a, d) => ({ cleared: T.resetAllResults(d) }),
};

// Commands not tied to one event. Broadcast after.
const GLOBAL = {
  'event.create':    a => {
    const d = T.newEvent();
    T.updateEvent(d, { name: a.name || 'New event', date: a.date || '', time: a.time || '', startsAt: a.startsAt || 0 });
    store.add(d);
    console.info(`[event] created draft "${d.event.name}"`);
    return { id: d.id };
  },
  'archive.restore': a => {
    const d = store.restoreArchive(a.id);
    console.info(`[event] past event ${a.id} restored as draft ${d.id}`);
    return { id: d.id };
  },
  'archive.delete':  a => {
    const name = store.archives.find(x => x.id === a.id)?.name;
    store.deleteArchive(a.id);
    console.info(`[event] past event ${a.id} ("${name}") moved to archive/trash`);
  },
};

// Live control and lights (the live event): LiveFight persists/broadcasts on its own.
const ACT = {
  'live.load':        a => live.load(a.id),
  'live.start':       () => live.start(),
  'live.pause':       () => live.pause(false),
  'live.stop':        () => live.pause(true),
  'live.fault':       a => live.fault(a.side),
  'live.count':       a => live.count(a.side, a.kind),
  'live.cancelCount': () => live.cancelCount(),
  'live.end':         a => live.end(a.winner, a.method),
  'live.unload':      () => live.unload(),
  'led.scene':        a => {
    const s = SCENES[a.name] || fail('Unknown scene');
    if (!led.connected) fail('LED driver offline');
    s().forEach(c => led.send(c));
  },
};

async function runCommand(op, args = {}, ev = null) {
  if (EVENT[op]) {
    const d = store.get(ev) || fail('Pick an event first');
    const result = await EVENT[op](args, d);
    store.save(d.id);           // no-op if the event was archived or deleted
    broadcast();
    return result;
  }
  if (GLOBAL[op]) { const result = await GLOBAL[op](args); broadcast(); return result; }
  if (ACT[op]) return ACT[op](args);
  fail(`Unknown command ${op}`);
}

// ── HTTP ──────────────────────────────────────────────────────────────────
const PUBLIC = path.join(cfg.root, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
                '.woff2': 'font/woff2' };
const ROUTES = { '/': 'index.html', '/ref': 'ref.html', '/obs': 'obs.html', '/obs/fight': 'obs-fight.html',
                 '/obs/bracket': 'obs-bracket.html', '/obs/ranking': 'obs-ranking.html' };

// The broadcast graphics may be framed by our own pages (the /obs previews); nothing else may be.
function headers(res, req, type, frameSelf = false) {
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-cache');
  if (type.startsWith('text/html')) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; " +
      `connect-src 'self' wss://${req.headers.host} ws://${req.headers.host}; ` +
      `frame-ancestors ${frameSelf ? "'self'" : "'none'"}; base-uri 'none'; form-action 'self'; object-src 'none'`);
  }
}

function json(res, req, code, body, extra = {}) {
  headers(res, req, 'application/json');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.writeHead(code);
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers['content-type']).startsWith('application/json')) return reject(new Error('JSON required'));
    let body = '';
    req.on('data', d => { body += d; if (body.length > 16384) { reject(new Error('Too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Bad JSON')); } });
  });
}

function serveFile(res, req, rel) {
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) || path.basename(file).startsWith('.')) return notFound(res, req);
  fs.readFile(file, (err, data) => {
    if (err) return notFound(res, req);
    headers(res, req, TYPES[path.extname(file)] || 'application/octet-stream', rel.startsWith('obs-'));
    res.end(data);
  });
}

function notFound(res, req) { json(res, req, 404, { error: 'not found' }); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && ROUTES[p]) return serveFile(res, req, ROUTES[p]);
    if (req.method === 'GET' && /^\/(css|js|fonts)\/[\w.-]+$|^\/favicon\.svg$/.test(p)) return serveFile(res, req, p.slice(1));
    const media = req.method === 'GET' && /^\/media\/([^/]+)$/.exec(p);
    if (media) {
      if (!MEDIA_NAME.test(media[1])) return notFound(res, req);
      return fs.readFile(path.join(mediaDir, media[1]), (err, data) => {
        if (err) return notFound(res, req);
        headers(res, req, MEDIA_TYPES[media[1].split('.').pop()]);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');   // names are random and never reused
        res.end(data);
      });
    }
    if (req.method === 'GET' && p === '/healthz') return json(res, req, 200, { ok: true, led: led.connected });
    if (req.method === 'GET' && p === '/api/state') return json(res, req, 200, publicState(Date.now()));
    if (req.method === 'GET' && p === '/api/session') return json(res, req, 200, { referee: auth.isReferee(req) });

    if (req.method === 'POST' && p === '/api/login') {
      const ip = auth.clientIp(req);
      if (auth.limited(ip)) return json(res, req, 429, { error: 'Too many attempts — wait a few minutes' });
      const body = await readJson(req);
      if (!auth.checkPassword(body.password)) {
        auth.failed(ip);
        console.warn(`[auth] failed referee login from ${ip}`);
        return json(res, req, 401, { error: 'Wrong password' });
      }
      const { token, maxAge } = auth.issue();
      console.info(`[auth] referee login from ${ip}`);
      return json(res, req, 200, { ok: true }, { 'Set-Cookie': auth.cookie(req, token, maxAge) });
    }
    if (req.method === 'POST' && p === '/api/logout') {
      await readJson(req);
      return json(res, req, 200, { ok: true }, { 'Set-Cookie': auth.cookie(req, '', 0) });
    }
    if (req.method === 'GET' && p === '/api/archive') return json(res, req, 200, auth.isReferee(req) ? store.archives : publicArchives());
    const arch = req.method === 'GET' && /^\/api\/archive\/([^/]+?)(\/export)?$/.exec(p);
    if (arch) {
      const d = store.readArchive(arch[1]);
      if (!d || (d.status === 'draft' && !auth.isReferee(req))) return notFound(res, req);   // drafts stay private
      if (!arch[2]) return json(res, req, 200, archiveState(d));
      if (!auth.isReferee(req)) return json(res, req, 401, { error: 'Referee login required' });
      return json(res, req, 200, d, { 'Content-Disposition': `attachment; filename="wpfl-${arch[1]}.json"` });
    }
    if (req.method === 'GET' && p === '/api/export') {   // full backup of one event, referees only
      if (!auth.isReferee(req)) return json(res, req, 401, { error: 'Referee login required' });
      const d = store.get(url.searchParams.get('ev'));
      if (!d) return notFound(res, req);
      const slug = d.event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
      return json(res, req, 200, d, { 'Content-Disposition': `attachment; filename="wpfl-${slug}-${new Date().toISOString().slice(0, 10)}.json"` });
    }
    notFound(res, req);
  } catch (e) {
    json(res, req, 400, { error: e.message });
  }
});

// ── WebSockets ────────────────────────────────────────────────────────────
// Large enough for a resized image from a referee (viewers sending anything big are dropped).
const wssClients = new WebSocketServer({ noServer: true, maxPayload: 2.5 * 1024 * 1024 });
const wssLed = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

// Referee sockets must come from our own pages (blocks cross-site WebSocket hijacking).
function sameOrigin(req) {
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}

server.on('upgrade', (req, socket, head) => {
  const p = new URL(req.url, 'http://local').pathname;
  if (p === '/ws') {
    const ref = auth.isReferee(req) && sameOrigin(req);
    wssClients.handleUpgrade(req, socket, head, ws => onClient(ws, ref));
  } else if (p === '/led') {
    if (!led.accepts(req)) {
      console.warn(`[led] rejected uplink from ${auth.clientIp(req)} (bad or missing key)`);
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    wssLed.handleUpgrade(req, socket, head, ws => led.attach(ws, auth.clientIp(req)));
  } else {
    socket.destroy();
  }
});

function onClient(ws, ref) {
  const c = { ws, ref, alive: true };
  clients.add(c);
  const now = Date.now();
  ws.send(JSON.stringify(ref ? refState(now) : { type: 'state', serverNow: now, build: BUILD, data: publicState(now) }));
  ws.on('pong', () => { c.alive = true; });
  ws.on('close', () => clients.delete(c));
  ws.on('error', () => {});
  ws.on('message', async data => {
    if (!c.ref && data.length > 4096) return ws.terminate();
    let m;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (m.type === 'time') return ws.send(JSON.stringify({ type: 'time', t: m.t, serverNow: Date.now() }));
    if (m.type !== 'cmd') return;
    const reply = { type: 'reply', id: m.id };
    if (!c.ref) {
      reply.error = 'Referee login required';
    } else {
      try {
        const result = await runCommand(String(m.op), m.args || {}, m.ev ?? null);
        reply.ok = true;
        if (result && typeof result === 'object') reply.result = result;
      } catch (e) {
        reply.error = e.message;
      }
    }
    flushBroadcast();   // new state first, then the reply: clients never see "ok" with stale data
    ws.send(JSON.stringify(reply));
  });
}

// Drop dead browser sockets (and keep proxies from idling them out).
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.ws.terminate(); clients.delete(c); continue; }
    c.alive = false;
    c.ws.ping();
  }
}, 25000).unref();

server.listen(cfg.port, cfg.host, () => {
  console.info(`[wpfl] match tracker on http://${cfg.host}:${cfg.port}  (data: ${cfg.dataDir}, ${store.events.size} events)`);
  console.info(`[wpfl] LED link ${led.enabled ? 'enabled at /led' : 'DISABLED (set LED_KEY)'}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { store.flush(); process.exit(0); });
}
