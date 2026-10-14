// Broadcast fight bar (/obs/fight): a lower-third scorebug for the fight in the arena —
// both robots with photo, record and faults, the match clock, start countdown,
// KO/pin counts and the result. Between fights it shows the next fight ("Up next"),
// and when nothing is queued (between rounds, after the last fight) the latest result.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
//
// URL options: pos=bottom (default) | top · idle=next (default) | hide (no bar between fights)
//              bg=, demo=1 (see obs.js)
import { fmtClock, METHOD } from './live.js';
import { $, esc, opt, stage, follow, avatar, fitText, eventTitle } from './obs.js';

stage('transparent');
const bar = $('bar');
bar.dataset.pos = opt.get('pos') === 'top' ? 'top' : 'bottom';
const demo = opt.get('demo') === '1';
const tracker = follow(() => draw());

const sideEl = s => {
  const root = $(s);
  return { root, pic: root.querySelector('.fb-pic'), count: root.querySelector('.fb-count'),
           name: root.querySelector('.fb-name'), meta: root.querySelector('.fb-meta'), id: undefined, label: '' };
};
const sides = { red: sideEl('red'), blue: sideEl('blue') };

// Demo: a 45 s loop through every state, using the next real pairing when there is one.
function demoFight(d, now) {
  const f = d.queue[0] && d.fights.find(x => x.id === d.queue[0].id);
  const [r, b] = f ? [f.red, f.blue] : [d.robots[0]?.id, d.robots[1]?.id];
  const t = (now / 1000) % 45, base = Math.floor(now / 45000) * 45000;
  const side = id => ({ id, name: d.robots.find(x => x.id === id)?.name ?? 'Robot', faults: t > 15 && id === b ? 1 : 0 });
  const live = { round: f?.round ?? 1, seq: f?.seq ?? 1, ranked: true, matchMs: 120000, red: side(r), blue: side(b),
                 phase: 'ready', running: false, elapsedMs: 0, count: null, winner: null, method: null };
  if (t >= 33) return { ...live, phase: 'done', elapsedMs: 98000, winner: 'red', method: 'ko' };
  if (t >= 7) {
    const count = t >= 20 ? { side: 'blue', kind: 'ko', endsAt: base + 30000, expired: t >= 30 } : null;
    return { ...live, phase: 'running', elapsedMs: 75000 + (t - 7) * 1000, count };
  }
  if (t >= 4) return { ...live, phase: 'countdown', countdownEndsAt: base + 7000 };
  return live;
}

// What the bar shows now: the loaded fight, else the next one in the queue, else the
// latest result (between rounds, after the last fight), else nothing.
function current(d, at, now) {
  if (demo) return { live: demoFight(d, now), at: now };
  if (d.live) return { live: d.live, at };
  if (opt.get('idle') === 'hide') return null;
  const side = (f, s) => ({ id: f[s], name: d.robots.find(x => x.id === f[s])?.name ?? '?', faults: f.faults?.[s] || 0 });
  const base = f => ({ round: f.round, seq: f.seq, ranked: f.ranked, red: side(f, 'red'), blue: side(f, 'blue'),
                       matchMs: d.event.matchSeconds * 1000 });
  const next = d.queue.map(q => d.fights.find(x => x.id === q.id)).find(f => f && f.blue);
  if (next) return { live: { ...base(next), phase: 'next', elapsedMs: 0, red: { ...side(next, 'red'), faults: 0 },
                             blue: { ...side(next, 'blue'), faults: 0 } }, at };
  const last = d.fights.filter(f => f.status === 'done' && f.blue && f.winner)
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0) || b.round - a.round || b.seq - a.seq)[0];
  if (!last) return null;
  return { live: { ...base(last), phase: 'last', elapsedMs: last.durationMs || 0, winner: last.winner, method: last.method }, at };
}

function draw() {
  const st = tracker.last(), now = tracker.now();
  const d = st?.d;
  const cur = d && current(d, st.at, now);
  bar.classList.toggle('on', !!cur);
  if (!cur) return;
  const { live } = cur;
  const robots = new Map(d.robots.map(r => [r.id, r]));
  const table = new Map(d.standings.map(s => [s.id, s]));

  $('evTitle').textContent = eventTitle(d);
  $('fightTitle').textContent = live.ranked === false ? `Exhibition · Fight ${live.seq}`
    : `Round ${live.round}${d.event.rounds ? ` of ${Math.max(d.event.rounds, d.rounds.length)}` : ''} · Fight ${live.seq}`;

  // Clock and phase
  const el = live.running ? live.elapsedMs + (now - cur.at) : live.elapsedMs;
  const left = Math.max(0, live.matchMs - el);
  let ph = live.phase, clock = fmtClock(left), label = '';
  if (ph === 'next') label = 'Up next';
  else if (ph === 'ready') label = 'Robots ready';
  else if (ph === 'countdown') {
    const n = Math.ceil((live.countdownEndsAt - now) / 1000);
    clock = n > 0 ? String(n) : 'GO!';
    label = 'Get ready';
  } else if (ph === 'running') label = left <= 30000 ? 'Final 30 s' : 'Fight!';
  else if (ph === 'paused') { ph = live.stopped ? 'stopped' : 'paused'; label = live.stopped ? 'Stopped' : 'Paused'; }
  else if (ph === 'time') label = 'Time — judges';
  else if (ph === 'done') label = `${live.winner} wins · ${METHOD[live.method] || ''}`;
  else if (ph === 'last') label = `Result · ${METHOD[live.method] || ''}`;   // the WINNER badge says who
  bar.dataset.phase = ph;
  bar.classList.toggle('low', ph === 'running' && left <= 30000);
  $('clock').textContent = ph === 'next' ? 'VS' : clock;
  $('phase').textContent = label;

  for (const s of ['red', 'blue']) {
    const e = sides[s], who = live[s], r = robots.get(who.id) || { name: who.name };
    if (e.id !== who.id || e.label !== r.name + r.photo) {   // new robot (or new photo/name): redraw the static parts
      e.id = who.id; e.label = r.name + r.photo;
      e.pic.firstElementChild.outerHTML = avatar(r);
      e.name.textContent = r.name;
      fitText(e.name, 50, 24);
    }
    const sr = table.get(who.id);
    const rec = sr && sr.played + sr.byes > 0 ? `<span class="rec">${sr.wins}–${sr.losses}</span><span>#${sr.rank}</span>` : '';
    const by = r.team || r.builder;
    const faults = who.faults ? `<span class="flt">${who.faults} FAULT${who.faults > 1 ? 'S' : ''}</span>` : '';
    const meta = rec + (by ? `<span class="by">${esc(by)}</span>` : '') + faults;
    if (e.meta.innerHTML !== meta) e.meta.innerHTML = meta;
    const over = ph === 'done' || ph === 'last';
    e.root.classList.toggle('win', over && live.winner === s);
    e.root.classList.toggle('lose', over && live.winner !== s);

    const cnt = live.count, on = !!cnt && cnt.side === s;
    e.count.classList.toggle('on', on);
    e.count.classList.toggle('exp', on && cnt.expired);
    if (on) e.count.innerHTML = cnt.expired ? `<b>${cnt.kind === 'pin' ? 'RELEASE' : 'OUT'}</b>`
      : `<small>${cnt.kind === 'pin' ? 'PIN' : 'COUNT'}</small><b>${Math.max(0, Math.ceil((cnt.endsAt - now) / 1000))}</b>`;
  }
}

setInterval(draw, 100);
