// Shared browser code: WebSocket client with server-clock sync, helpers, and
// the live fight card used by both the viewer and the referee console.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.

export const $ = id => document.getElementById(id);
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

let toastT;
export function toast(msg, err) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.className = '', 2800);
}

export const fmtClock = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const fmtAgo = ms => ms == null ? '—' : ms < 60000 ? 'just now' : `${Math.floor(ms / 60000)} min ago`;
export const METHOD = { ko: 'KO', judges: 'Judges', forfeit: 'Forfeit', bye: 'Bye' };

// ── Connection ─────────────────────────────────────────────────────────────
// onState(msg) gets every state push. now() = estimated server time.
export function connect({ onState, onStatus, ref = false }) {
  let ws, offset = 0, seq = 0, build = null;
  const pending = new Map();

  function open() {
    // Only the referee console asks for the referee feed; every other page reads the public
    // one, even in a browser that holds the referee cookie.
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws${ref ? '?ref=1' : ''}`);
    ws.onopen = () => { onStatus?.(true); syncTime(); };
    ws.onclose = () => {
      onStatus?.(false);
      for (const p of pending.values()) p.reject(new Error('Disconnected'));
      pending.clear();
      setTimeout(open, 1500);
    };
    ws.onmessage = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'time') {
        const rtt = Date.now() - m.t;
        offset = m.serverNow + rtt / 2 - Date.now();
      } else if (m.type === 'state') {
        // A deploy changed the page files while this page was open: load the new ones
        // (old code cannot read new data).
        if (build && m.build && m.build !== build) return location.reload();
        build ??= m.build;
        onState(m);
      } else if (m.type === 'reply') {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
      }
    };
  }
  function syncTime() { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'time', t: Date.now() })); }
  setInterval(syncTime, 30000);
  open();

  return {
    now: () => Date.now() + offset,
    // ev = the event the command is for (ignored by live-fight and global commands)
    cmd(op, args = {}, ev = null) {
      return new Promise((resolve, reject) => {
        if (ws.readyState !== 1) return reject(new Error('Not connected'));
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ type: 'cmd', op, args, ev, id }));
      });
    },
  };
}

// ── Fight card ─────────────────────────────────────────────────────────────
const PHASE = { ready: 'Ready', countdown: 'Get ready', running: 'Fight!', paused: 'Paused', time: 'Time — judges',
                done: 'Final' };

export function fightCard(root) {
  root.innerHTML = `
    <div class="meta"><b data-k="title"></b><span class="muted" data-k="sub"></span></div>
    <div class="fight">
      <div class="side red"><span class="corner">RED</span><span class="name" data-k="rn"></span>
        <span class="faults" data-k="rf"></span><div class="count" data-k="rc"></div></div>
      <div class="center"><div class="clock" data-k="clock">0:00</div><div class="phase" data-k="phase"></div></div>
      <div class="side blue"><span class="corner">BLUE</span><span class="name" data-k="bn"></span>
        <span class="faults" data-k="bf"></span><div class="count" data-k="bc"></div></div>
      <div class="big" data-k="big"></div>
    </div>`;
  const k = {};
  root.querySelectorAll('[data-k]').forEach(e => k[e.dataset.k] = e);
  const sides = root.querySelectorAll('.side');

  // live: snapshot from the server · at: serverNow of that snapshot · now: server time now
  // records: robot id → "W–L" (optional)
  return function update(live, at, now, records = {}) {
    const el = live.running ? live.elapsedMs + (now - at) : live.elapsedMs;
    const left = Math.max(0, live.matchMs - el);
    k.title.textContent = live.ranked === false ? `Exhibition · Fight ${live.seq}` : `Round ${live.round} · Fight ${live.seq}`;
    k.sub.textContent = '';
    k.rn.textContent = live.red.name;
    k.bn.textContent = live.blue.name;
    sides[0].dataset.id = live.red.id;
    sides[1].dataset.id = live.blue.id;
    const info = s => [records[live[s].id] && `Record ${records[live[s].id]}`, live[s].faults && `Faults ${live[s].faults}`]
      .filter(Boolean).join(' · ');
    k.rf.textContent = info('red');
    k.bf.textContent = info('blue');
    k.clock.textContent = fmtClock(left);
    k.clock.className = 'clock' + (left === 0 ? ' zero' : left <= 30000 ? ' low' : '');

    let ph = live.phase, label = PHASE[ph];
    if (ph === 'paused' && live.stopped) { ph = 'stopped'; label = 'Stopped'; }
    if (ph === 'done') label = `${live.winner} wins · ${METHOD[live.method] || ''}`;
    k.phase.textContent = label;
    k.phase.className = 'phase ' + ph;

    sides[0].classList.toggle('win', ph === 'done' && live.winner === 'red');
    sides[1].classList.toggle('win', ph === 'done' && live.winner === 'blue');
    sides[0].classList.toggle('lose', ph === 'done' && live.winner === 'blue');
    sides[1].classList.toggle('lose', ph === 'done' && live.winner === 'red');

    if (ph === 'countdown') {
      const n = Math.ceil((live.countdownEndsAt - now) / 1000);
      k.big.textContent = n > 0 ? n : 'GO!';
      k.big.classList.add('on');
    } else k.big.classList.remove('on');

    for (const s of ['red', 'blue']) {
      const c = k[s[0] + 'c'], cnt = live.count;
      const on = !!cnt && cnt.side === s;
      c.classList.toggle('on', on);
      c.classList.toggle('exp', on && cnt.expired);
      if (on) c.textContent = cnt.expired ? (cnt.kind === 'pin' ? 'RELEASE' : 'OUT') : Math.max(0, Math.ceil((cnt.endsAt - now) / 1000));
    }
  };
}

// One fight as a compact row (rounds, queue, results).
// withRound: label the row "R2·3" (for lists that mix rounds).
export function matchRow(f, names, liveId, withRound = false) {
  const p = s => {
    const cls = f.status === 'done' && f.method !== 'bye' ? (f.winner === s ? ' w' : ' l') : f.winner === s ? ' w' : '';
    return `<div class="p ${s}${cls}"><i></i><span>${esc(f[s] ? names[f[s]] ?? '?' : 'BYE')}</span></div>`;
  };
  let res = '';
  if (f.id === liveId) res = '<b>LIVE</b>';
  else if (f.status === 'done') res = f.method === 'bye' ? '<b>Bye</b>' :
    `<b>${f.winner === 'red' ? 'Red' : 'Blue'}</b>${METHOD[f.method]}${f.durationMs ? ' · ' + fmtClock(f.durationMs) : ''}`;
  if (f.ranked === false) res += '<span class="tag">exh</span>';
  return `<div class="match${f.id === liveId ? ' live' : ''}"><span class="seq">${withRound ? `R${f.round}·${f.seq}` : f.seq}</span>${p('red')}<span class="res">${res}</span>${f.method === 'bye' ? '<div class="p blue"><i></i><span class="muted">—</span></div>' : p('blue')}</div>`;
}

// ── Bracket graphic (Swiss rounds as card grids, Challonge style) ──────────
// Each fight is a two-row card; the winner's box gets a check. Hover or tap a
// robot to light up all of its fights across the rounds.
export function bracketGraphic(d, names, liveId) {
  const row = (f, s) => {
    const id = f[s];
    if (!id) return '<div class="bk-p bye"><span>BYE</span><b></b></div>';
    const done = f.status === 'done' && f.method !== 'bye';
    const cls = [s, f.winner === s ? 'w' : done ? 'l' : ''].join(' ');
    const tip = f.winner === s ? `${METHOD[f.method]}${f.durationMs ? ' · ' + fmtClock(f.durationMs) : ''}` : '';
    return `<div class="bk-p ${cls}" data-r="${id}"${tip ? ` title="${esc(names[id])} won · ${tip}"` : ''}>` +
           `<span>${esc(names[id] ?? '?')}</span><b>${f.winner === s ? '✓' : ''}</b></div>`;
  };
  return d.rounds.map(r => {
    const fights = d.fights.filter(f => f.round === r.n).sort((a, b) => a.seq - b.seq);
    const left = fights.filter(f => f.status !== 'done').length;
    return `<section class="bk-round"><h3>Round ${r.n}<small>${left ? `${left} to go` : 'complete'}</small></h3><div class="bk-grid">` +
      fights.map(f => `<div class="bk-m${f.id === liveId ? ' live' : ''}${f.ranked === false ? ' exh' : ''}">
        <span class="bk-n">${f.seq}</span><div class="bk-box">${row(f, 'red')}${row(f, 'blue')}</div></div>`).join('') +
      '</div></section>';
  }).join('') || '<p class="muted">No rounds yet.</p>';
}

// Hover highlights a robot; tap/click pins it (tap again to clear).
// onPick(id | null) lets the page show who is followed.
export function followRobots(box, onPick) {
  let pinned = null;
  const paint = id => box.querySelectorAll('.bk-p[data-r]').forEach(e => e.classList.toggle('hl', e.dataset.r === id));
  box.addEventListener('mouseover', e => { const p = e.target.closest('.bk-p[data-r]'); if (p) paint(p.dataset.r); });
  box.addEventListener('mouseleave', () => paint(pinned));
  box.addEventListener('click', e => {
    const p = e.target.closest('.bk-p[data-r]');
    pinned = p && p.dataset.r !== pinned ? p.dataset.r : null;
    paint(pinned);
    onPick?.(pinned);
  });
  return { refresh: () => paint(pinned), pinned: () => pinned };
}

// ── Event result ───────────────────────────────────────────────────────────
// finished = every planned round generated and every ranked fight decided.
// clear    = finished with exactly one robot in first place.
export function eventResult(d) {
  const finished = d.rounds.length > 0 && d.rounds.length >= d.event.rounds &&
                   d.fights.every(f => f.ranked === false || f.status === 'done');
  const leaders = d.standings.filter(s => s.rank === 1 && s.played + s.byes > 0);
  return { finished, clear: finished && leaders.length === 1, champion: leaders.length === 1 ? leaders[0] : null, leaders };
}

// Compact ranking rows: medal badge, name, record.
export function rankRows(rows) {
  return rows.map(s => `<div class="rk${s.dropped ? ' out' : ''}"><span class="medal m${s.rank <= 3 ? s.rank : 0}">${s.rank}</span>
    <span class="rk-n">${esc(s.name)}</span><span class="rk-r num">${s.wins}–${s.losses}</span>
    <span class="rk-b num" title="Buchholz">${s.buchholz}</span></div>`).join('') || '<p class="muted">No results yet.</p>';
}

// ── Battlecards ────────────────────────────────────────────────────────────
// Trading-card style (5:7), one per robot, from public fields only, plus live
// stats. Front: name, photo, builder, bio, stats. Back (click to flip): team
// picture and text, fight log. Frame color: gold/silver/bronze for the top 3,
// otherwise a color picked from the robot's name.
const initials = n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0]).join('').toUpperCase() || '?';
const hue = n => [...n].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7) % 8;
// Card text (max 220) gets a size that fills the same box: larger when short, smaller when long.
const fitText = t => t.length <= 30 ? ' l3' : t.length <= 60 ? ' l2' : t.length <= 85 ? ' l1'
  : t.length <= 110 ? '' : t.length <= 165 ? ' s2' : ' s3';
const cardText = (t, none) => {
  t = (t || '').length > 220 ? `${t.slice(0, 219).replace(/\s+\S*$/, '')}…` : t || '';
  return `<div class="bc-text">${t ? `<p class="bc-bio${fitText(t)}">${esc(t)}</p>` : `<p class="bc-bio none">${none}</p>`}</div>`;
};
// Cards flipped to their back stay flipped when the grid is redrawn.
const flipped = new Set();

// showHidden: include robots whose card is hidden from viewers (referee preview, marked HIDDEN).
// edit: add an edit button to each card (referee preview).
export function battlecards(d, { showHidden = false, edit = false } = {}) {
  const st = new Map(d.standings.map(s => [s.id, s]));
  const names = Object.fromEntries(d.robots.map(r => [r.id, r.name]));
  const liveId = d.live && d.live.phase !== 'done' ? d.live.fightId : null;
  const order = d.robots.filter(r => showHidden || !r.hideCard).sort((a, b) => a.dropped - b.dropped ||
    (st.get(a.id)?.rank ?? 999) - (st.get(b.id)?.rank ?? 999) || a.name.localeCompare(b.name));
  const total = order.length;
  const started = d.fights.some(f => f.status === 'done');   // before the first result: no stats, just the robot
  const evName = `${/wpfl/i.test(d.event.name) ? '' : 'WPFL · '}${esc(d.event.name)}`;
  return order.map((r, i) => {
    const s = st.get(r.id) || { wins: 0, losses: 0, ko: 0, buchholz: 0, played: 0, byes: 0 };
    const ranked = s.played + s.byes > 0;
    const tier = r.dropped ? 'out' : ranked && s.rank <= 3 ? `t${s.rank}` : `h${hue(r.name)}`;
    const num = `${String(i + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}`;
    const mine = d.fights.filter(f => f.red === r.id || f.blue === r.id).sort((a, b) => a.round - b.round || a.seq - b.seq);
    const oppOf = f => names[f[f.red === r.id ? 'blue' : 'red']] ?? '?';
    const won = f => f.method === 'bye' || f.winner === (f.red === r.id ? 'red' : 'blue');
    const next = mine.find(f => f.id === liveId) || d.queue.map(q => mine.find(f => f.id === q.id)).find(Boolean);
    const live = !!next && next.id === liveId;

    // Front
    const type = [r.builder && `Built by ${esc(r.builder)}`, r.team && esc(r.team)].filter(Boolean).join(' · ') || 'Combat robot · 1 kg';
    const art = r.photo
      ? `<img src="/media/${esc(r.photo)}" alt="${esc(r.name)}" loading="lazy">`
      : `<span class="bc-ini">${esc(initials(r.name))}</span>`;
    const stats = started ? `<div class="bc-stats"><div><b>${s.wins}</b><span>WINS</span></div><div><b>${s.losses}</b><span>LOSSES</span></div>
      <div><b>${s.ko}</b><span>KOS</span></div><div title="Buchholz: the combined wins of this robot's opponents (tiebreaker)"><b>${s.buchholz}</b><span>BUCHHOLZ</span></div></div>` : '';

    // Back: newest fight first, so the latest always shows when the log is long.
    const teamName = esc(r.team || r.builder || r.name);
    const teamSub = r.team && r.builder ? `Built by ${esc(r.builder)}` : 'The team';
    const art2 = r.photo2
      ? `<img src="/media/${esc(r.photo2)}" alt="${teamName}" loading="lazy">`
      : '<span class="bc-mark">WPFL</span>';
    const status = r.dropped ? '<p class="bc-status">Out of the tournament</p>'
      : live ? `<p class="bc-status live">● LIVE NOW vs ${esc(oppOf(next))}</p>`
      : next ? `<p class="bc-status">Next: Round ${next.round} vs ${esc(oppOf(next))}</p>` : '';
    const rows = mine.filter(f => f.status === 'done').reverse().map(f => `<li><span class="res ${won(f) ? 'w' : 'l'}">${won(f) ? 'W' : 'L'}</span>
      <span>R${f.round} ${f.method === 'bye' ? '· bye' : `vs ${esc(oppOf(f))} <span class="muted">· ${METHOD[f.method]}${f.ranked === false ? ' · exh' : ''}</span>`}</span></li>`).join('');
    const log = status || rows ? `${status}<ul>${rows}</ul>` : `<p class="bc-status">${started ? 'No fights yet.' : 'Fights start on event day.'}</p>`;

    return `<article class="bc ${tier}${r.hideCard ? ' hidden-card' : ''}${flipped.has(r.id) ? ' flipped' : ''}" id="robot-${r.id}"
      data-name="${esc(r.name.toLowerCase())}" tabindex="0" role="button" aria-pressed="${flipped.has(r.id)}" aria-label="${esc(r.name)} battlecard: press to flip">
      ${r.hideCard ? '<div class="bc-flag"><span>Hidden</span></div>' : ''}
      ${edit ? '<button class="bc-edit" data-edit title="Edit this robot">✎</button>' : ''}
      <div class="bc-inner">
        <section class="bc-face bc-front"><div class="bc-frame">
          <header class="bc-head"><h3 title="${esc(r.name)}">${esc(r.name)}</h3>${ranked ? `<span class="bc-rank">#${s.rank}</span>` : ''}</header>
          <div class="bc-art">${art}${live ? '<span class="bc-live">● LIVE</span>' : ''}${ranked ? `<span class="bc-rec">${s.wins}–${s.losses}</span>` : ''}</div>
          <div class="bc-type" title="${type}">${type}</div>
          ${cardText(r.bio, 'No intel on this robot yet.')}
          ${stats}
          <footer class="bc-foot"><span>${evName}</span><span>${num}</span></footer>
        </div></section>
        <section class="bc-face bc-back"><div class="bc-frame">
          <div class="bc-art2">${art2}<div class="bc-team"><small>${teamSub}</small><b title="${teamName}">${teamName}</b></div></div>
          ${cardText(r.teamBio, 'No team intel yet.')}
          <div class="bc-log"><h4>Fight log</h4>${log}</div>
          <footer class="bc-foot"><span>${esc(r.name)}</span><span>${num}</span></footer>
        </div></section>
      </div>
    </article>`;
  }).join('') || '<p class="muted">No robots registered yet.</p>';
}

// Click (or Enter / Space) flips a card. onEdit(robotId): the referee preview's edit button.
export function flipCards(container, { onEdit } = {}) {
  const flip = card => {
    const id = card.id.replace('robot-', '');
    const on = !flipped.has(id);
    if (on) flipped.add(id); else flipped.delete(id);
    card.classList.toggle('flipped', on);
    card.setAttribute('aria-pressed', on);
    card.classList.remove('flipping');
    void card.offsetWidth;   // restart the lift + shine animation
    card.classList.add('flipping');
    clearTimeout(card.flipTimer);
    card.flipTimer = setTimeout(() => card.classList.remove('flipping'), 900);
  };
  container.addEventListener('click', e => {
    const card = e.target.closest('.bc');
    if (!card || e.target.closest('a')) return;
    if (e.target.closest('[data-edit]')) return onEdit?.(card.id.replace('robot-', ''));
    flip(card);
  });
  container.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.bc')) { e.preventDefault(); flip(e.target); }
  });
}
