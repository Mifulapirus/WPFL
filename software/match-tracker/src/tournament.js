// Tournament model: robots, Swiss rounds, fights, standings.
// Pure functions over the event document. Mutating operations throw an Error
// with a human-readable message when the request is not allowed.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
//
// SWISS (as run here)
//   • Every round pairs robots with the same or nearest record (adjacent in the
//     standings, "Monrad" style), never repeating an opponent if avoidable.
//   • Round 1 is a random draw.
//   • Odd count → the lowest-ranked robot that has not had a bye gets one (= a win).
//   • Standings: wins, then Buchholz (sum of opponents' wins), then fewer losses, then name.
//   • Exhibition fights (ranked: false) never count.

export const METHODS = ['ko', 'judges', 'forfeit', 'bye'];
export const SIDES = ['red', 'blue'];

// Event lifecycle: draft → published (public as "upcoming") → live (started; one
// at a time) → archived as a past event. See server.js 'event.status'.
export const STATUSES = ['draft', 'published', 'live'];

export function newEvent() {
  return {
    version: 2,
    id: null,                // set by the store
    status: 'draft',
    event: {
      name: 'New event',
      date: '',              // YYYY-MM-DD
      time: '',              // HH:MM start time (venue time)
      startsAt: 0,           // epoch ms of date+time, computed in the referee's browser; drives the countdown
      location: '',
      link: '',              // registration / info page
      note: '',
      image: '',             // banner / art (data/media file name, set only by the server)
      rounds: 4,             // Swiss rounds planned
      matchSeconds: 120,     // rules §E: 2 minutes
      countdownSeconds: 3,
      countSeconds: 10,      // incapacitation / pin count
      restMinutes: 10,       // rules: ≥ 10 min between a robot's fights
    },
    robots: [],
    rounds: [],
    fights: [],
    live: null,
    nextId: 1,
  };
}

const nextId = (doc, prefix) => `${prefix}${doc.nextId++}`;
const fail = msg => { throw new Error(msg); };

export const robotById = (doc, id) => doc.robots.find(r => r.id === id);
export const fightById = (doc, id) => doc.fights.find(f => f.id === id);
export const lastRound = doc => doc.rounds[doc.rounds.length - 1] || null;
const isLive = (doc, f) => doc.live && doc.live.fightId === f.id;

function cleanName(v, what, max = 40) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) fail(`${what} is required`);
  if (s.length > max) fail(`${what}: max ${max} characters`);
  return s;
}
const cleanText = (v, max) => String(v ?? '').trim().slice(0, max);

// Battlecard text: fits the card's text box (4 lines at full size, smaller font when longer).
export const BIO_MAX = 220;
// Over the limit → cut at a word boundary with "…" (e.g. long registration answers).
export function clipBio(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (s.length <= BIO_MAX) return s;
  const cut = s.slice(0, BIO_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return (space > BIO_MAX - 40 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '') + '…';
}

// ── Event ──────────────────────────────────────────────────────────────────
export function updateEvent(doc, a) {
  const e = doc.event;
  const num = (v, lo, hi, what) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) fail(`${what} must be ${lo}–${hi}`);
    return n;
  };
  if (a.name !== undefined) e.name = cleanName(a.name, 'Event name', 80);
  if (a.date !== undefined) {
    const d = cleanText(a.date, 10);
    if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))) fail('Date must be YYYY-MM-DD');
    e.date = d;
  }
  if (a.time !== undefined) {
    const t = cleanText(a.time, 5);
    if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) fail('Time must be HH:MM');
    e.time = t;
  }
  if (a.startsAt !== undefined) e.startsAt = Math.max(0, Math.round(Number(a.startsAt) || 0));
  if (a.location !== undefined) e.location = cleanText(a.location, 120);
  if (a.link !== undefined) {
    const l = cleanText(a.link, 300);
    if (l && !/^https?:\/\/[^\s"'<>]+$/i.test(l)) fail('Link must start with https://');
    e.link = l;
  }
  if (a.note !== undefined) e.note = cleanText(a.note, 300);
  if (a.rounds !== undefined) e.rounds = Math.round(num(a.rounds, Math.max(1, doc.rounds.length), 20, 'Rounds'));
  if (a.matchSeconds !== undefined) e.matchSeconds = Math.round(num(a.matchSeconds, 10, 900, 'Match length'));
  if (a.countdownSeconds !== undefined) e.countdownSeconds = Math.round(num(a.countdownSeconds, 0, 10, 'Countdown'));
  if (a.countSeconds !== undefined) e.countSeconds = Math.round(num(a.countSeconds, 3, 30, 'Count'));
  if (a.restMinutes !== undefined) e.restMinutes = Math.round(num(a.restMinutes, 0, 60, 'Rest'));
}

// ── Robots ─────────────────────────────────────────────────────────────────
// Public fields: name, builder, team, bio (battlecard front text), photo (front
// art), teamBio and photo2 (back of the card: team text, team/action picture;
// pictures are data/media file names set only by the server), hideCard (no
// battlecard for viewers; the robot still shows in brackets). Referee-only:
// notes, rulesAck (the registration's rules checklist). See publicRobot().
// A hidden card's texts and pictures are not sent at all.
export const publicRobot = ({ id, name, builder, team, bio, photo, teamBio, photo2, hideCard, dropped }) =>
  ({ id, name, builder, team, bio: hideCard ? '' : bio || '', photo: hideCard ? '' : photo || '',
     teamBio: hideCard ? '' : teamBio || '', photo2: hideCard ? '' : photo2 || '', hideCard: !!hideCard, dropped });

export function addRobot(doc, a) {
  const name = cleanName(a.name, 'Robot name', 60);
  if (doc.robots.some(r => r.name.toLowerCase() === name.toLowerCase())) fail(`"${name}" already exists`);
  const r = { id: nextId(doc, 'r'), name, builder: cleanText(a.builder, 60), team: cleanText(a.team, 60),
              bio: clipBio(a.bio), teamBio: clipBio(a.teamBio), notes: cleanText(a.notes, 200), rulesAck: cleanText(a.rulesAck, 300), dropped: false };
  doc.robots.push(r);
  return r;
}

export function updateRobot(doc, a) {
  const r = robotById(doc, a.id) || fail('Unknown robot');
  if (a.name !== undefined) {
    const name = cleanName(a.name, 'Robot name', 60);
    if (doc.robots.some(o => o !== r && o.name.toLowerCase() === name.toLowerCase())) fail(`"${name}" already exists`);
    r.name = name;
  }
  if (a.builder !== undefined) r.builder = cleanText(a.builder, 60);
  if (a.team !== undefined) r.team = cleanText(a.team, 60);
  if (a.notes !== undefined) r.notes = cleanText(a.notes, 200);
  if (a.bio !== undefined) r.bio = clipBio(a.bio);
  if (a.teamBio !== undefined) r.teamBio = clipBio(a.teamBio);
  if (a.rulesAck !== undefined) r.rulesAck = cleanText(a.rulesAck, 300);
  if (a.dropped !== undefined) r.dropped = !!a.dropped;
  if (a.hideCard !== undefined) r.hideCard = !!a.hideCard;   // dropped robots are skipped by future pairings
  return r;
}

// Copy robots (with bios, photos and notes) from another event; names already
// present are skipped. Records never travel: each event starts its own bracket.
export function copyRobots(doc, from) {
  const have = new Set(doc.robots.map(r => r.name.toLowerCase()));
  const added = [], skipped = [];
  for (const r of from.robots) {
    if (have.has(r.name.toLowerCase())) { skipped.push(r.name); continue; }
    const { id, dropped, ...fields } = r;
    doc.robots.push({ ...fields, id: nextId(doc, 'r'), dropped: false });
    have.add(r.name.toLowerCase());
    added.push(r.name);
  }
  return { added, skipped };
}

export function removeRobot(doc, id) {
  robotById(doc, id) || fail('Unknown robot');
  if (doc.fights.some(f => f.red === id || f.blue === id)) fail('Robot has fights — drop it instead');
  doc.robots = doc.robots.filter(r => r.id !== id);
}

// ── Standings ──────────────────────────────────────────────────────────────
export function standings(doc) {
  const rows = new Map(doc.robots.map(r => [r.id, {
    id: r.id, name: r.name, dropped: r.dropped,
    wins: 0, losses: 0, byes: 0, played: 0, ko: 0, opponents: [], reds: 0, lastEndedAt: 0,
  }]));
  for (const f of doc.fights) {
    if (f.status !== 'done' || f.ranked === false) continue;
    const red = rows.get(f.red), blue = rows.get(f.blue);
    if (f.method === 'bye') { if (red) { red.wins++; red.byes++; } continue; }
    if (!red || !blue) continue;
    red.played++; blue.played++; red.reds++;
    red.opponents.push(blue.id); blue.opponents.push(red.id);
    const [w, l] = f.winner === 'red' ? [red, blue] : [blue, red];
    w.wins++; l.losses++;
    if (f.method === 'ko') w.ko++;
    for (const r of [red, blue]) r.lastEndedAt = Math.max(r.lastEndedAt, f.endedAt || 0);
  }
  // Rest tracking also counts unranked fights.
  for (const f of doc.fights) {
    if (f.status !== 'done' || f.method === 'bye' || f.ranked !== false) continue;
    for (const id of [f.red, f.blue]) { const r = rows.get(id); if (r) r.lastEndedAt = Math.max(r.lastEndedAt, f.endedAt || 0); }
  }
  const list = [...rows.values()];
  for (const r of list) r.buchholz = r.opponents.reduce((s, id) => s + rows.get(id).wins, 0);
  list.sort((a, b) => b.wins - a.wins || b.buchholz - a.buchholz || a.losses - b.losses ||
                      a.name.localeCompare(b.name));
  let rank = 0, prev = null;
  list.forEach((r, i) => {
    if (!prev || r.wins !== prev.wins || r.buchholz !== prev.buchholz || r.losses !== prev.losses) rank = i + 1;
    r.rank = rank; prev = r;
  });
  return list;
}

// ── Pairing ────────────────────────────────────────────────────────────────
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Pair a ranked list into adjacent couples, backtracking around rematches.
function solvePairs(list, met) {
  let steps = 0;
  const rec = rest => {
    if (!rest.length) return [];
    const [a, ...others] = rest;
    for (let i = 0; i < others.length; i++) {
      if (++steps > 200000) return null;
      if (met(a, others[i])) continue;
      const sub = rec(others.filter((_, j) => j !== i));
      if (sub) return [[a, others[i]], ...sub];
    }
    return null;
  };
  return rec(list);
}

export function generateRound(doc, rng = Math.random, now = Date.now()) {
  const last = lastRound(doc);
  if (last && doc.fights.some(f => f.round === last.n && f.status !== 'done' && f.ranked !== false)) {
    fail(`Finish round ${last.n} first`);
  }
  if (doc.rounds.length >= doc.event.rounds) fail(`All ${doc.event.rounds} rounds generated — raise "Rounds" in Event to add more`);
  const table = standings(doc).filter(r => !r.dropped);
  if (table.length < 2) fail('Need at least 2 active robots');

  let order = last ? table : shuffle(table, rng);
  let bye = null;
  if (order.length % 2) {
    bye = [...order].reverse().find(r => r.byes === 0) || order[order.length - 1];
    order = order.filter(r => r !== bye);
  }
  const pairs = solvePairs(order, (a, b) => a.opponents.includes(b.id)) || solvePairs(order, () => false);

  const n = doc.rounds.length + 1;
  doc.rounds.push({ n, createdAt: now });
  let seq = 1;
  for (const [a, b] of pairs) {
    // Fewer red corners so far goes red; tie → higher seed.
    const [red, blue] = b.reds < a.reds ? [b, a] : [a, b];
    doc.fights.push(newFight(doc, n, seq++, red.id, blue.id));
  }
  if (bye) {
    doc.fights.push({ ...newFight(doc, n, seq++, bye.id, null), status: 'done', winner: 'red', method: 'bye', endedAt: now });
  }
  return n;
}

function newFight(doc, round, seq, red, blue, ranked = true) {
  return { id: nextId(doc, 'f'), round, seq, red, blue, ranked, status: 'pending', winner: null, method: null,
           faults: { red: 0, blue: 0 }, durationMs: null, startedAt: null, endedAt: null };
}

export function deleteRound(doc, n) {
  const last = lastRound(doc);
  if (!last || last.n !== n) fail('Only the latest round can be deleted');
  const fights = doc.fights.filter(f => f.round === n);
  if (fights.some(f => f.status === 'done' && f.method !== 'bye')) fail('Round has results — reset them first');
  if (fights.some(f => isLive(doc, f))) fail('A fight of this round is loaded');
  doc.fights = doc.fights.filter(f => f.round !== n);
  doc.rounds.pop();
}

// ── Fights ─────────────────────────────────────────────────────────────────
function checkPair(doc, red, blue) {
  for (const id of [red, blue]) if (id && !robotById(doc, id)) fail('Unknown robot');
  if (!red) fail('Red corner is required');
  if (red === blue) fail('A robot cannot fight itself');
}

export function addFight(doc, a) {
  const round = Number(a.round) || (lastRound(doc)?.n ?? fail('Generate a round first'));
  if (!doc.rounds.some(r => r.n === round)) fail('Unknown round');
  checkPair(doc, a.red, a.blue || fail('Blue corner is required'));
  const seq = Math.max(0, ...doc.fights.filter(f => f.round === round).map(f => f.seq)) + 1;
  const f = newFight(doc, round, seq, a.red, a.blue, a.ranked !== false);
  doc.fights.push(f);
  return f;
}

export function updateFight(doc, a) {
  const f = fightById(doc, a.id) || fail('Unknown fight');
  if (f.status !== 'pending') fail('Only pending fights can be edited');
  if (isLive(doc, f)) fail('Fight is loaded — unload it first');
  const red = a.red !== undefined ? a.red : f.red, blue = a.blue !== undefined ? a.blue : f.blue;
  checkPair(doc, red, blue || fail('Blue corner is required'));
  f.red = red; f.blue = blue;
  if (a.ranked !== undefined) f.ranked = !!a.ranked;
  return f;
}

export function swapCorners(doc, id) {
  const f = fightById(doc, id) || fail('Unknown fight');
  if (f.status === 'done' || f.method === 'bye' || !f.blue) fail('Cannot swap this fight');
  [f.red, f.blue] = [f.blue, f.red];
  f.faults = { red: f.faults.blue, blue: f.faults.red };
}

export function moveFight(doc, id, dir) {
  const f = fightById(doc, id) || fail('Unknown fight');
  const list = doc.fights.filter(x => x.round === f.round).sort((a, b) => a.seq - b.seq);
  const i = list.indexOf(f), j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= list.length) return;
  [list[i].seq, list[j].seq] = [list[j].seq, list[i].seq];
}

export function removeFight(doc, id) {
  const f = fightById(doc, id) || fail('Unknown fight');
  if (f.status === 'done' && f.method !== 'bye') fail('Reset the result first');
  if (isLive(doc, f)) fail('Fight is loaded — unload it first');
  doc.fights = doc.fights.filter(x => x !== f);
}

export function setResult(doc, a, now = Date.now()) {
  const f = fightById(doc, a.id) || fail('Unknown fight');
  if (!SIDES.includes(a.winner)) fail('Winner must be red or blue');
  if (!METHODS.includes(a.method) || a.method === 'bye') fail('Method must be ko, judges or forfeit');
  if (!f.blue) fail('A bye has no opponent');
  f.status = 'done'; f.winner = a.winner; f.method = a.method;
  f.endedAt = f.endedAt || now;
  return f;
}

export function resetResult(doc, id) {
  const f = fightById(doc, id) || fail('Unknown fight');
  if (f.method === 'bye') fail('Byes cannot be reset — delete the round instead');
  if (isLive(doc, f)) fail('Fight is loaded — unload it first');
  Object.assign(f, { status: 'pending', winner: null, method: null, endedAt: null, startedAt: null, durationMs: null,
                     faults: { red: 0, blue: 0 } });
}

// Clear every result of one robot (its fight history): the fights go back to
// pending, to be fought again or recorded by hand. Byes stay (delete the round
// instead). Returns how many results were cleared.
export function resetRobotResults(doc, id) {
  robotById(doc, id) || fail('Unknown robot');
  const fights = doc.fights.filter(f => (f.red === id || f.blue === id) && f.status === 'done' && f.method !== 'bye');
  if (fights.some(f => isLive(doc, f))) fail('One of its fights is loaded — unload it first');
  for (const f of fights) resetResult(doc, f.id);
  return fights.length;
}

// Pending fights in running order, with each robot's rest so far (ms) — the
// referee sees who is fresh enough for the next fight.
export function queue(doc, now = Date.now()) {
  const table = new Map(standings(doc).map(r => [r.id, r]));
  const rest = id => { const r = table.get(id); return r && r.lastEndedAt ? now - r.lastEndedAt : null; };
  return doc.fights
    .filter(f => f.status === 'pending')
    .sort((a, b) => a.round - b.round || a.seq - b.seq)
    .map(f => ({ id: f.id, round: f.round, seq: f.seq, restRed: rest(f.red), restBlue: rest(f.blue) }));
}
