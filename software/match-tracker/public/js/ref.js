// Referee console: fight control, bracket editing, robots, event + LED link.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
import { $, esc, toast, connect, fightCard, matchRow, fmtClock, METHOD, bracketGraphic, followRobots, eventResult, battlecards, flipCards } from './live.js';

let msg = null, conn = null;
const TABS = ['fight', 'bracket', 'robots', 'event'];

// The event this referee is working on (Bracket, Robots, Event tabs). The Fight
// tab always runs the live event.
let sel = null;
try { sel = sessionStorage.getItem('wpfl_ref_ev'); } catch {}
const EMPTY = { id: null, status: 'none', event: { name: '', rounds: 4, restMinutes: 10 }, robots: [], rounds: [], fights: [],
                standings: [], queue: [], live: null, importInfo: null };
const ev = () => msg?.data.byId[sel] || EMPTY;
const liveEv = () => (msg?.data.liveId && msg.data.byId[msg.data.liveId]) || EMPTY;
function selectEvent(id) {
  sel = id || null;
  try { sessionStorage.setItem('wpfl_ref_ev', sel || ''); } catch {}
  for (const k of Object.keys(sigs)) delete sigs[k];
  if (msg) onState(msg);
}

// ── Login ──────────────────────────────────────────────────────────────────
async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

$('loginForm').onsubmit = async e => {
  e.preventDefault();
  try { await api('/api/login', { password: $('pw').value }); location.reload(); }
  catch (err) { $('loginMsg').textContent = err.message; $('pw').select(); }
};
$('logout').onclick = async () => { await api('/api/logout').catch(() => {}); location.reload(); };

function showLogin() {
  $('login').classList.remove('hide');
  $('nav').classList.add('hide');
  TABS.forEach(t => $('tab-' + t).classList.add('hide'));
  $('pw').focus();
}

fetch('/api/session').then(r => r.json()).then(s => {
  if (!s.referee) return showLogin();
  $('nav').classList.remove('hide');
  $('ledChip').classList.remove('hide');
  $('evPick').classList.remove('hide');
  showTab(sessionTab() || 'fight');
  conn = connect({ onState, onStatus: on => $('dot').classList.toggle('on', on) });
});

// ── Tabs ───────────────────────────────────────────────────────────────────
function sessionTab() { try { return sessionStorage.getItem('wpfl_ref_tab'); } catch { return null; } }
function showTab(t) {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('sel', x.dataset.tab === t));
  TABS.forEach(x => $('tab-' + x).classList.toggle('hide', x !== t));
  try { sessionStorage.setItem('wpfl_ref_tab', t); } catch {}
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

// Run a command; errors become a red toast. Resolves to the result (true if there is
// none), or undefined on error.
// evId: the event it is for (default: the one being edited).
async function run(op, args, okMsg, evId = sel) {
  try {
    const r = await conn.cmd(op, args, evId);
    if (okMsg) toast(okMsg);
    return r === undefined ? true : r;
  } catch (e) { toast(e.message, true); }
}

// ── Rendering ──────────────────────────────────────────────────────────────
// Lists are only rebuilt when their data changed, and never while you are
// typing in them (the server pushes state often).
const sigs = {};
function renderIf(key, box, data, fn) {
  const sig = JSON.stringify(data);
  if (sigs[key] === sig) return;
  if (box.contains(document.activeElement) && document.activeElement.matches('input,select,textarea')) return;
  sigs[key] = sig;
  fn();
}

const updateFight = fightCard($('liveCard'));
const names = d => Object.fromEntries(d.robots.map(r => [r.id, r.name]));
const records = d => Object.fromEntries(d.standings.map(s => [s.id, `${s.wins}–${s.losses}`]));
const nextFight = d => d.queue.find(q => q.id !== d.live?.fightId);

function onState(m) {
  if (!m.ref) return showLogin();
  msg = m;
  if (!sel || !m.data.byId[sel]) {   // keep a valid selection: the live event, else the first one
    sel = m.data.liveId || m.data.events[0]?.id || null;
    for (const k of Object.keys(sigs)) delete sigs[k];
  }
  const L = liveEv(), E = ev();
  $('login').classList.add('hide');
  renderLed(m.led);
  renderPicker(m.data);
  renderFightTab(L, names(L));
  renderBracket(E, names(E));
  renderRobots(E);
  renderHistory(E);
  renderImport(E);
  renderCopyFrom(m.data);
  renderEvents(m.data);
  renderEvent(E);
  renderPast(m.data);
  tick();
}

function tick() {
  const L = liveEv();
  if (L.live) updateFight(L.live, msg.serverNow, conn.now(), records(L));
}
setInterval(tick, 100);

// ── Fight tab ──────────────────────────────────────────────────────────────
function renderFightTab(d, n) {
  const live = d.live, ph = live?.phase;
  $('liveCard').classList.toggle('hide', !live);
  $('idleCard').classList.toggle('hide', !!live);
  const nf = nextFight(d);
  $('arenaTitle').textContent = d.id ? `Arena · ${d.event.name}` : 'Arena';
  if (!live) {
    const f = nf && d.fights.find(x => x.id === nf.id);
    $('idleText').innerHTML = !d.id ? 'No event is live. Open the <b>Event</b> tab and press <b>Start event</b> on the event you are running.'
      : f ? `Next: <b class="tr">${esc(n[f.red])}</b> vs <b class="tb">${esc(n[f.blue])}</b>` : nextRoundHtml(d);
    $('loadNext').classList.toggle('hide', !nf);
  }

  const can = {
    start: ph === 'ready' || ph === 'paused',
    pause: ph === 'countdown' || ph === 'running',
    stop: ph === 'countdown' || ph === 'running' || (ph === 'paused' && !live.stopped),
    fault: !!live && ph !== 'done',
    count: ph === 'running',
    cancel: !!live?.count,
    win: !!live && ph !== 'done',
    unload: !!live,
    next: !!nf && (!live || ph === 'ready' || ph === 'done'),
  };
  $('bStart').disabled = !can.start;
  $('bStart').textContent = ph === 'paused' ? 'RESUME' : 'START';
  $('bPause').disabled = !can.pause;
  $('bStop').disabled = !can.stop;
  document.querySelectorAll('[data-fault]').forEach(b => b.disabled = !can.fault);
  document.querySelectorAll('[data-count]').forEach(b => b.disabled = !can.count);
  $('bCancelCount').disabled = !can.cancel;
  document.querySelectorAll('[data-win]').forEach(b => b.disabled = !can.win);
  $('bUnload').disabled = !can.unload;
  $('bNext').disabled = !can.next;

  const restMs = d.event.restMinutes * 60000;
  $('restRule').textContent = d.event.restMinutes ? `min rest ${d.event.restMinutes} min` : '';
  const rows = d.queue.filter(q => q.id !== live?.fightId).slice(0, 8).map(q => {
    const f = d.fights.find(x => x.id === q.id);
    const tired = [['red', q.restRed], ['blue', q.restBlue]]
      .filter(([, r]) => r != null && r < restMs).map(([s, r]) => `${esc(n[f[s]])} rested ${Math.floor(r / 60000)} min`);
    return { f, tired };
  });
  renderIf('queue', $('queue'), [rows.map(r => [r.f, r.tired]), live?.fightId, live?.phase, n], () => {
    $('queue').innerHTML = rows.map(({ f, tired }) => `<div class="q"><div>${matchRow(f, n, null, true)}
        ${tired.length ? `<div class="muted warn">⚠ ${tired.join(' · ')}</div>` : ''}</div>
        <button class="sm" data-load="${f.id}" ${can.next || !live ? '' : 'disabled'}>Load</button></div>`).join('') ||
      (live ? nextRoundHtml(d) : `<p class="muted">${d.id ? 'Queue is empty.' : 'No event is live.'}</p>`);   // with no fight loaded the Arena card shows the button
  });
}

$('queue').onclick = $('idleText').onclick = e => {
  const b = e.target.closest('button');
  if (b?.dataset.load) run('live.load', { id: b.dataset.load });
  if (b?.dataset.gen) nextRound(b, b.dataset.gen === 'extra');
};

// What to do when the queue is empty: generate the next round right here.
function nextRoundHtml(d) {
  const last = d.rounds[d.rounds.length - 1];
  const open = last ? d.fights.filter(f => f.round === last.n && f.status !== 'done' && f.ranked !== false).length : 0;
  const active = d.robots.filter(r => !r.dropped).length;
  if (open) return `<p class="muted">The last fight of round ${last.n} is in the arena — finish it to generate the next round.</p>`;
  if (active < 2) return '<p class="muted">Add at least 2 robots (Robots tab) to start round 1.</p>';
  const n = d.rounds.length + 1;
  if (n <= d.event.rounds) {
    return `<div class="btns"><button class="pri" data-gen="next">Generate round ${n}</button>
      <span class="muted">${last ? `Round ${last.n} is complete.` : `${active} robots ready.`} ${d.event.rounds} rounds planned.</span></div>`;
  }
  const res = eventResult(d);
  const verdict = res.clear
    ? `🏆 <b>${esc(res.champion.name)}</b> wins (${res.champion.wins}–${res.champion.losses}) — the public Live page shows the final ranking (a few seconds after the last result).`
    : `Tie for first: ${res.leaders.map(s => `<b>${esc(s.name)}</b>`).join(', ')} — add a tiebreak fight (Bracket → Edit → Add a fight, counts for standings) or another round.`;
  return `<p class="mb">${verdict}</p><div class="btns"><button data-gen="extra">Add round ${n}</button>
    <span class="muted">All ${d.event.rounds} planned rounds are complete.</span></div>`;
}

// Rounds from the Fight tab are always for the live event.
async function nextRound(btn, extra) {
  const d = liveEv(), n = d.rounds.length + 1;
  if (extra && !confirm(`All ${d.event.rounds} planned rounds are done. Add round ${n}?`)) return;
  btn.disabled = true;
  if (extra) {
    await run('event.update', { rounds: n }, null, d.id);   // state arrives before the reply
    if (liveEv().event.rounds < n) { btn.disabled = false; return; }
  }
  await run('round.generate', {}, `Round ${n} generated`, d.id);
}
$('loadNext').onclick = $('bNext').onclick = () => { const nf = nextFight(liveEv()); if (nf) run('live.load', { id: nf.id }); };
$('bStart').onclick = () => run('live.start');
$('bPause').onclick = () => run('live.pause');
$('bStop').onclick = () => run('live.stop');
$('bCancelCount').onclick = () => run('live.cancelCount');
document.querySelectorAll('[data-fault]').forEach(b => b.onclick = () => run('live.fault', { side: b.dataset.fault }));
document.querySelectorAll('[data-count]').forEach(b => b.onclick = () => run('live.count', { side: b.dataset.count, kind: b.dataset.kind }));
document.querySelectorAll('[data-win]').forEach(b => b.onclick = () => {
  const l = liveEv().live, side = b.dataset.win;
  if (confirm(`${l[side].name} (${side.toUpperCase()}) wins by ${METHOD[b.dataset.method]}?`)) {
    run('live.end', { winner: side, method: b.dataset.method });
  }
});
$('bUnload').onclick = () => {
  const l = liveEv().live;
  if (['countdown', 'running', 'paused', 'time'].includes(l.phase) &&
      !confirm('This fight has no result yet. Unload it anyway? (It stays in the queue.)')) return;
  run('live.unload');
};

// ── Bracket tab ────────────────────────────────────────────────────────────
function robotOptions(d, selected, blank) {
  const opts = d.robots.slice().sort((a, b) => a.dropped - b.dropped || a.name.localeCompare(b.name))
    .map(r => `<option value="${r.id}"${r.id === selected ? ' selected' : ''}>${esc(r.name)}${r.dropped ? ' (out)' : ''}</option>`);
  return (blank ? `<option value="">${blank}</option>` : '') + opts.join('');
}

function renderBracket(d, n) {
  const last = d.rounds[d.rounds.length - 1];
  const open = last ? d.fights.filter(f => f.round === last.n && f.status !== 'done' && f.ranked !== false).length : 0;
  $('swissTitle').textContent = `Swiss — ${d.rounds.length} of ${d.event.rounds} rounds`;
  $('genRound').textContent = `Generate round ${d.rounds.length + 1}`;
  $('genRound').disabled = d.rounds.length >= d.event.rounds || open > 0;
  $('genRound').title = open ? `Finish round ${last.n} first` : '';
  $('delRound').disabled = !last;

  const liveId = d.live?.fightId;
  renderIf('bkGfx', $('bkGfx'), [d.rounds, d.fights, n, liveId], () => {
    $('bkGfx').innerHTML = bracketGraphic(d, n, liveId);
    follow.refresh();
  });
  showFollow();
  renderIf('bracket', $('bracket'), [d.rounds, d.fights, d.robots, liveId], () => {
    $('bracket').innerHTML = d.rounds.slice().reverse().map(r => {
      const fights = d.fights.filter(f => f.round === r.n).sort((a, b) => a.seq - b.seq);
      return `<div class="card"><div class="head"><h2>Round ${r.n}</h2>
        <span class="muted">${fights.filter(f => f.status === 'done').length}/${fights.length} done</span></div>
        ${fights.map(f => bracketRow(d, n, f, liveId)).join('')}</div>`;
    }).join('') || '<div class="card"><p class="muted">No rounds yet. Add robots, then generate round 1.</p></div>';
  });
  renderIf('addFight', $('addFight').parentElement, [d.rounds, d.robots], () => {
    $('addRound').innerHTML = d.rounds.map(r => `<option value="${r.n}">Round ${r.n}</option>`).reverse().join('');
    $('addRed').innerHTML = robotOptions(d, null, 'Red…');
    $('addBlue').innerHTML = robotOptions(d, null, 'Blue…');
  });
}

function bracketRow(d, n, f, liveId) {
  const who = s => {
    const cls = f.status === 'done' && f.method !== 'bye' ? (f.winner === s ? ' w' : ' l') : '';
    return `<div class="who ${s}${cls}"><i></i><span>${f[s] ? esc(n[f[s]]) : 'BYE'}</span></div>`;
  };
  let body, acts = '';
  if (f.method === 'bye') {
    body = who('red') + '<div class="who muted"><span>bye — counts as a win</span></div>';
  } else if (f.id === liveId) {
    body = who('red') + who('blue');
    acts = '<span class="tag">live</span>';
  } else if (f.status === 'done') {
    body = who('red') + who('blue');
    acts = `<span class="muted">${f.winner === 'red' ? 'Red' : 'Blue'} · ${METHOD[f.method]}${f.durationMs ? ' · ' + fmtClock(f.durationMs) : ''}</span>
      <button class="sm" data-act="reset">Reset</button>`;
  } else {
    body = `<select class="red" data-set="red">${robotOptions(d, f.red)}</select>
            <select class="blue" data-set="blue">${robotOptions(d, f.blue)}</select>`;
    acts = `${d.id === msg.data.liveId ? '<button class="sm" data-act="load">Load</button>' : ''}
      <button class="sm icon" data-act="swap" title="Swap corners">⇄</button>
      <button class="sm icon" data-act="up" title="Earlier">▲</button><button class="sm icon" data-act="down" title="Later">▼</button>
      <select class="sm" data-act="result"><option value="">Result…</option>
        ${['red', 'blue'].flatMap(s => ['ko', 'judges', 'forfeit'].map(m =>
          `<option value="${s}:${m}">${s === 'red' ? 'Red' : 'Blue'} · ${METHOD[m]}</option>`)).join('')}</select>
      <button class="sm icon danger" data-act="remove" title="Remove fight">✕</button>`;
  }
  if (f.ranked === false) acts = '<span class="tag">exh</span>' + acts;
  return `<div class="bf${f.id === liveId ? ' live' : ''}" data-id="${f.id}"><span class="seq">${f.seq}</span>${body}<div class="acts">${acts}</div></div>`;
}

// View (graphic) / Edit (editor) switch, remembered per browser tab.
const follow = followRobots($('bkGfx'), () => showFollow());
function showFollow() {
  const id = follow.pinned(), s = id && ev().standings.find(x => x.id === id);
  $('follow').innerHTML = s
    ? `<span class="chip ok">Following</span><b>${esc(s.name)}</b><span class="muted">${s.wins}–${s.losses} · rank #${s.rank} · click again to clear</span>`
    : '<span class="muted">Hover or click a robot to follow it through the rounds. ✓ = winner.</span>';
}
function bracketMode(m) {
  document.querySelectorAll('#bkMode button').forEach(b => b.classList.toggle('sel', b.dataset.m === m));
  $('bkView').classList.toggle('hide', m !== 'view');
  $('bracket').classList.toggle('hide', m !== 'edit');
  $('addCard').classList.toggle('hide', m !== 'edit');
  try { sessionStorage.setItem('wpfl_bk_mode', m); } catch {}
}
document.querySelectorAll('#bkMode button').forEach(b => b.onclick = () => bracketMode(b.dataset.m));
try { bracketMode(sessionStorage.getItem('wpfl_bk_mode') || 'view'); } catch { bracketMode('view'); }

$('bracket').onclick = e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.closest('.bf').dataset.id;
  ({
    load:   () => { run('live.load', { id }); showTab('fight'); },
    swap:   () => run('fight.swap', { id }),
    up:     () => run('fight.move', { id, dir: -1 }),
    down:   () => run('fight.move', { id, dir: 1 }),
    reset:  () => confirm('Clear this result?') && run('fight.reset', { id }),
    remove: () => confirm('Remove this fight?') && run('fight.remove', { id }),
  })[b.dataset.act]?.();
};
$('bracket').onchange = e => {
  const s = e.target, id = s.closest('.bf')?.dataset.id;
  if (!id) return;
  if (s.dataset.set) return run('fight.update', { id, [s.dataset.set]: s.value });
  if (s.dataset.act === 'result' && s.value) {
    const [winner, method] = s.value.split(':');
    if (confirm(`Record ${winner.toUpperCase()} win by ${METHOD[method]}?`)) run('fight.result', { id, winner, method });
    else s.value = '';
  }
};
$('genRound').onclick = () => run('round.generate', {}, 'Round generated');
$('delRound').onclick = () => {
  const last = ev().rounds[ev().rounds.length - 1];
  if (last && confirm(`Delete round ${last.n} and all its pairings?`)) run('round.delete', { n: last.n }, 'Round deleted');
};
$('addFight').onclick = () => run('fight.add', { round: +$('addRound').value, red: $('addRed').value, blue: $('addBlue').value,
                                                ranked: $('addRanked').checked }, 'Fight added');

// ── Robots tab ─────────────────────────────────────────────────────────────
function renderRobots(d) {
  renderIf('cards', $('cardPreview'), [d.robots, d.fights, d.standings, d.queue.map(q => q.id), d.live?.fightId, d.live?.phase, d.event.name],
    () => { $('cardPreview').innerHTML = battlecards(d, { showHidden: true, edit: true }); });
  const rec = Object.fromEntries(d.standings.map(s => [s.id, s]));
  const used = new Set(d.fights.flatMap(f => [f.red, f.blue]));
  $('robotsTitle').textContent = `Robots (${d.robots.filter(r => !r.dropped).length} active)`;
  renderIf('robots', $('robotList'), [d.robots, d.standings.map(s => [s.id, s.wins, s.losses]), [...used]], () => {
    $('robotList').innerHTML = d.robots.map(r => `<div class="rb" data-id="${r.id}">
      <input type="text" class="name" data-f="name" value="${esc(r.name)}" maxlength="40" aria-label="Name">
      <input type="text" data-f="builder" value="${esc(r.builder)}" placeholder="Builder" maxlength="60">
      <input type="text" data-f="team" value="${esc(r.team)}" placeholder="Team" maxlength="60">
      <input type="text" class="notes" data-f="notes" value="${esc(r.notes)}" placeholder="Notes" maxlength="200">
      <span class="rec"><button class="sm" data-hist title="Fight history: change or reset results">${used.has(r.id) && rec[r.id]
        ? `${rec[r.id].wins}–${rec[r.id].losses}` : 'History'}</button>${rulesBadge(r)}</span>
      <label class="btns" title="Active robots are paired in new rounds"><input type="checkbox" data-f="active" ${r.dropped ? '' : 'checked'}>Active</label>
      <label class="btns" title="Show this robot's battlecard to viewers (it stays in brackets either way)"><input type="checkbox" data-f="card" ${r.hideCard ? '' : 'checked'}>Card</label>
      <button class="sm icon danger" data-del ${used.has(r.id) ? 'disabled title="Has fights — set inactive instead"' : 'title="Delete"'}>✕</button>
      ${cardSide(r, 'photo', 'bio', 'Front', 'Card front (public, max 220): weapon, story, trash talk…')}
      ${cardSide(r, 'photo2', 'teamBio', 'Back', 'Card back (public, max 220): the team, who they are, where they’re from…')}
    </div>`).join('') || '<p class="muted">No robots yet.</p>';
  });
  $('resetAll').disabled = !d.fights.some(f => f.status === 'done' && f.method !== 'bye');
}

// One side of the battlecard in the edit row: picture + its text (front: robot photo + bio; back: team/action photo + team text).
const BIO_MAX = 220;
function cardSide(r, pic, text, label, hint) {
  const len = (r[text] || '').length;
  return `<div class="rb-photo"><span class="rb-side">${label}<span class="bio-count${len > BIO_MAX ? ' warn' : ''}" data-count="${text}">${len}/${BIO_MAX}</span></span>
      ${r[pic] ? `<img class="thumb" src="/media/${esc(r[pic])}" alt="">` : `<span class="thumb ph">no photo</span>`}
      <button class="sm" data-photo="${pic}">${r[pic] ? 'Replace' : 'Photo'}</button>${r[pic] ? `<button class="sm icon danger" data-nophoto="${pic}" title="Remove photo">✕</button>` : ''}</div>
    <textarea data-f="${text}" rows="2" maxlength="${BIO_MAX}" placeholder="${hint}">${esc(r[text] || '')}</textarea>`;
}
// Live character count for the card texts.
$('robotList').oninput = e => {
  const f = e.target.dataset.f;
  if (f !== 'bio' && f !== 'teamBio') return;
  const c = e.target.closest('.rb').querySelector(`[data-count="${f}"]`);
  c.textContent = `${e.target.value.length}/${BIO_MAX}`;
  c.classList.toggle('warn', e.target.value.length >= BIO_MAX);
};
$('robotList').onchange = e => {
  if (historyChange(e)) return;
  const el = e.target, id = el.closest('.rb')?.dataset.id;
  if (!id || !el.dataset.f) return;
  const args = el.dataset.f === 'active' ? { id, dropped: !el.checked }
    : el.dataset.f === 'card' ? { id, hideCard: !el.checked } : { id, [el.dataset.f]: el.value };
  run('robot.update', args).then(r => { if (!r) sigs.robots = null; });   // failed → redraw from server data
};
// Edit list ↔ card preview (the public battlecards), remembered per browser tab.
function robotsMode(m) {
  document.querySelectorAll('#rbMode button').forEach(b => b.classList.toggle('sel', b.dataset.m === m));
  $('robotList').classList.toggle('hide', m !== 'edit');
  $('rbHelp').classList.toggle('hide', m !== 'edit');
  $('cardView').classList.toggle('hide', m !== 'cards');
  try { sessionStorage.setItem('wpfl_rb_mode', m); } catch {}
}
document.querySelectorAll('#rbMode button').forEach(b => b.onclick = () => robotsMode(b.dataset.m));
try { robotsMode(sessionStorage.getItem('wpfl_rb_mode') || 'edit'); } catch { robotsMode('edit'); }
// In the preview: click a card to flip it; its ✎ button edits that robot.
flipCards($('cardPreview'), { onEdit: id => {
  robotsMode('edit');
  const row = document.querySelector(`#robotList .rb[data-id="${id}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('flash');
  setTimeout(() => row.classList.remove('flash'), 1600);
} });

// Battlecard photos: one hidden file input shared by every row.
let photoFor = null, photoSlot = 'photo';
$('photoFile').onchange = async () => {
  const f = $('photoFile').files[0];
  if (!f || !photoFor) return;
  try {
    const data = await resizeImage(f, 900);
    if (await run('robot.photo', { id: photoFor, slot: photoSlot, data }, 'Photo saved')) sigs.robots = null;
  } catch (e) { toast(e.message, true); }
};
$('robotList').onclick = e => {
  const row = e.target.closest('.rb'), id = row?.dataset.id;
  const add = e.target.closest('button[data-photo]'), del = e.target.closest('button[data-nophoto]');
  if (add) { photoFor = id; photoSlot = add.dataset.photo; $('photoFile').value = ''; return $('photoFile').click(); }
  if (del) {
    const side = del.dataset.nophoto === 'photo2' ? 'back' : 'front';
    if (confirm(`Remove this robot’s ${side} photo?`)) run('robot.photo', { id, slot: del.dataset.nophoto, data: null }).then(() => { sigs.robots = null; });
    return;
  }
  if (e.target.closest('button[data-hist]')) return openHistory(id);
  if (e.target.closest('.rb-hist')) return historyClick(e);
  const b = e.target.closest('button[data-del]');
  if (b && confirm('Delete this robot?')) run('robot.remove', { id: b.closest('.rb').dataset.id });
};
$('addRobot').onclick = async () => {
  const r = await run('robot.add', { name: $('nName').value, builder: $('nBuilder').value, team: $('nTeam').value,
                                     notes: $('nNotes').value, bio: $('nBio').value });
  if (r) { toast(`Added ${r.name}`); ['nName', 'nBuilder', 'nTeam', 'nNotes', 'nBio'].forEach(id => $(id).value = ''); $('nName').focus(); }
};

// ── Fight history: opens inside the robot's row (record button). Change a
// result in place, reset one fight, or all of that robot's results.
let histId = null;
function openHistory(id) {
  histId = histId === id ? null : id;   // the same button again closes it
  sigs.hist = null;
  renderHistory(ev());
}
function renderHistory(d) {
  document.querySelectorAll('#robotList .rb-hist').forEach(e => { if (e.parentElement.dataset.id !== histId) e.remove(); });
  document.querySelectorAll('#robotList button[data-hist]').forEach(b => b.classList.toggle('sel', b.closest('.rb').dataset.id === histId));
  const r = histId && d.robots.find(x => x.id === histId);
  const row = r && document.querySelector(`#robotList .rb[data-id="${r.id}"]`);
  if (!row) return;
  let box = row.querySelector('.rb-hist');
  if (!box) {   // new, or the robot list was redrawn
    box = row.appendChild(document.createElement('div'));
    box.className = 'rb-hist';
    sigs.hist = null;
  }
  const mine = d.fights.filter(f => f.red === r.id || f.blue === r.id).sort((a, b) => a.round - b.round || a.seq - b.seq);
  const liveId = d.live?.fightId, n = names(d);
  const resettable = mine.filter(f => f.status === 'done' && f.method !== 'bye');
  renderIf('hist', box, [r.id, mine, n, liveId], () => {
    const blocked = resettable.some(f => f.id === liveId);
    box.innerHTML = `<div class="head"><h2>Fight history — ${esc(r.name)}</h2>
        <button class="sm danger" data-hreset ${!resettable.length || blocked ? 'disabled' : ''}
          title="${blocked ? 'One of its fights is loaded — unload it first' : 'All of this robot’s results back to not fought'}">Reset this robot’s results</button></div>
      ${mine.map(f => historyRow(f, r.id, n, liveId)).join('') || '<p class="muted">No fights yet.</p>'}`;
  });
}
function historyRow(f, id, n, liveId) {
  const me = f.red === id ? 'red' : 'blue', opp = me === 'red' ? 'blue' : 'red';
  const done = f.status === 'done' && f.method !== 'bye';
  const who = s => `<div class="who ${s}${done ? (f.winner === s ? ' w' : ' l') : ''}"><i></i><span>${f[s] ? esc(n[f[s]]) : 'BYE'}</span></div>`;
  const choose = label => `<select class="sm" data-hact="result"><option value="">${label}</option>${[me, opp].flatMap(s =>
    ['ko', 'judges', 'forfeit'].filter(m => !(done && f.winner === s && f.method === m)).map(m =>
      `<option value="${s}:${m}">${esc(n[f[s]])} wins · ${METHOD[m]}</option>`)).join('')}</select>`;
  let body = who(me) + who(opp), acts;
  if (f.method === 'bye') { body = who(me) + '<div class="who muted"><span>bye — counts as a win</span></div>'; acts = '<span class="muted">Win · Bye</span>'; }
  else if (f.id === liveId) acts = '<span class="tag">live</span><span class="muted">use the Fight tab</span>';
  else if (done) acts = `<span class="muted">${f.winner === me ? 'Won' : 'Lost'} · ${METHOD[f.method]}${f.durationMs ? ' · ' + fmtClock(f.durationMs) : ''}</span>
    ${choose('Change…')}<button class="sm" data-hact="reset">Reset</button>`;
  else acts = `<span class="muted">not fought</span>${choose('Result…')}`;
  if (f.ranked === false) acts = '<span class="tag">exh</span>' + acts;
  return `<div class="bf${f.id === liveId ? ' live' : ''}" data-fid="${f.id}"><span class="seq">R${f.round}·${f.seq}</span>${body}<div class="acts">${acts}</div></div>`;
}
// Clicks and changes inside an open history (called from the robot list handlers).
function historyClick(e) {
  if (e.target.closest('button[data-hreset]')) {
    const d = ev(), r = d.robots.find(x => x.id === histId);
    const n = d.fights.filter(f => (f.red === histId || f.blue === histId) && f.status === 'done' && f.method !== 'bye').length;
    if (r && confirm(`Clear all ${n} results of ${r.name}? Those fights go back to the queue (their opponents lose those results too).`))
      run('robot.resetResults', { id: histId }).then(res => res && toast(`Cleared ${res.cleared} result${res.cleared === 1 ? '' : 's'}`));
    return true;
  }
  const b = e.target.closest('button[data-hact="reset"]');
  if (b && confirm('Clear this result? The fight goes back to the queue.')) run('fight.reset', { id: b.closest('.bf').dataset.fid }, 'Result cleared');
  return !!b;
}
function historyChange(e) {
  const sel = e.target;
  if (sel.dataset.hact !== 'result') return false;
  if (!sel.value) return true;
  const id = sel.closest('.bf').dataset.fid, [winner, method] = sel.value.split(':');
  const f = ev().fights.find(x => x.id === id), name = f && names(ev())[f[winner]];
  if (confirm(`Record ${name} (${winner}) win by ${METHOD[method]}?`)) run('fight.result', { id, winner, method }, 'Result saved');
  else sel.value = '';
  return true;
}
$('resetAll').onclick = async () => {
  const d = ev();
  const n = d.fights.filter(f => f.status === 'done' && f.method !== 'bye').length;
  if (!n) return toast('No results to reset');
  if (!confirm(`Reset ALL ${n} results of "${d.event.name}"? Every fight goes back to not fought; pairings and byes stay.`)) return;
  if (!confirm('Are you sure? Standings go back to zero. This cannot be undone (download a backup in Event first if unsure).')) return;
  const res = await run('results.resetAll', {});
  if (res) toast(`Cleared ${res.cleared} result${res.cleared === 1 ? '' : 's'}`);
};

// Rules checklist from the registration form: "Rules 4" = items confirmed (hover for the text).
function rulesBadge(r) {
  if (!r.rulesAck) return '';
  const n = r.rulesAck.split(/,\s*(?=[A-Z])/).length;
  return ` <span class="rules" title="${esc(r.rulesAck)}">✓ rules ${n}</span>`;
}

// ── Import registrations ──
async function doImport(args) {
  const r = await run('robots.import', args);
  if (!r) return;
  toast(`Imported: ${r.added.length} new, ${r.updated.length} updated`);
  $('importResult').innerHTML = [
    r.added.length && `<b>New:</b> ${r.added.map(esc).join(', ')}`,
    r.updated.length && `<b>Updated:</b> ${r.updated.map(esc).join(', ')}`,
    r.unchanged && `${r.unchanged} unchanged`,
    r.skipped.length && `<span class="warn"><b>Skipped:</b> ${r.skipped.map(esc).join('; ')}</span>`,
    r.ignoredColumns.length && `Not imported: ${r.ignoredColumns.map(h => esc(h.length > 40 ? h.slice(0, 40) + '…' : h)).join(' · ')}`,
  ].filter(Boolean).join('<br>');
  sigs.robots = null;
}
$('importSheet').onclick = () => {
  const url = $('sheetUrl').value.trim();
  if (!url) return toast('Paste the Google Sheets link first', true);
  doImport({ url });
};
$('importCsv').onclick = async () => {
  const f = $('importFile').files[0];
  if (!f) return toast('Choose a CSV file first', true);
  if (f.size > 60000) return toast('CSV too large (max 60 KB)', true);
  doImport({ csv: await f.text() });
};
function renderImport(d) {
  const i = d.importInfo;
  $('importInfo').textContent = i ? `Last import ${new Date(i.at).toLocaleString()} · ${i.added} new, ${i.updated} updated` : '';
  if (i?.url && !$('sheetUrl').value && document.activeElement !== $('sheetUrl')) $('sheetUrl').value = i.url;
}
$('nName').onkeydown = e => { if (e.key === 'Enter') $('addRobot').click(); };

// Copy robots from another event (e.g. the same builders at the next event).
function renderCopyFrom(data) {
  renderIf('copyFrom', $('copyFrom'), [data.events.map(e => [e.id, e.name, e.robots]), sel], () => {
    const others = data.events.filter(e => e.id !== sel && e.robots);
    $('copyFrom').innerHTML = others.map(e => `<option value="${e.id}">${esc(e.name)} (${e.robots})</option>`).join('') ||
      '<option value="">no other event has robots</option>';
    $('copyBtn').disabled = !others.length;
  });
}
$('copyBtn').onclick = async () => {
  const from = $('copyFrom').value, src = msg.data.events.find(e => e.id === from);
  if (!from || !confirm(`Copy the robots of "${src.name}" into "${ev().event.name}"?`)) return;
  const r = await run('robots.copyFrom', { from });
  if (r) toast(`Copied ${r.added.length} robots${r.skipped.length ? `, skipped ${r.skipped.length} already here` : ''}`);
};

// ── Events: list, details, lifecycle ───────────────────────────────────────
const STATUS = { draft: ['Draft', 'bad'], published: ['Published', ''], live: ['● LIVE', 'ok'] };
const chipFor = s => `<span class="chip ${STATUS[s]?.[1] || ''}">${STATUS[s]?.[0] || s}</span>`;
const whenOf = e => [e.date, e.time].filter(Boolean).join(' · ') || 'no date yet';

function renderPicker(data) {
  renderIf('picker', $('evPick'), [data.events.map(e => [e.id, e.name, e.status]), sel], () => {
    $('evPick').innerHTML = data.events.map(e =>
      `<option value="${e.id}"${e.id === sel ? ' selected' : ''}>${e.status === 'live' ? '● ' : ''}${esc(e.name)}${e.status === 'draft' ? ' (draft)' : ''}</option>`)
      .join('') || '<option value="">No events yet</option>';
  });
  const s = ev().status;
  $('evChip').className = `chip opt ${STATUS[s]?.[1] || ''}`;
  $('evChip').textContent = STATUS[s]?.[0] || '';
}
$('evPick').onchange = () => selectEvent($('evPick').value);

function renderEvents(data) {
  renderIf('evList', $('evList'), [data.events, sel], () => {
    $('evList').innerHTML = data.events.map(e => `<div class="q evrow${e.id === sel ? ' cur' : ''}" data-id="${e.id}">
      <div>${e.image ? `<img class="thumb" src="/media/${esc(e.image)}" alt="">` : ''}<b>${esc(e.name)}</b> ${chipFor(e.status)}
        <div class="muted">${esc(whenOf(e))}${e.location ? ' · ' + esc(e.location) : ''} · ${e.robots} robots</div></div>
      <div class="btns">${e.id === sel ? '<span class="muted">editing</span>' : '<button class="sm" data-pick>Edit</button>'}</div></div>`).join('') ||
      '<p class="muted">No events yet — create one with <b>+ New event</b>.</p>';
  });
}
$('evList').onclick = e => { const b = e.target.closest('button[data-pick]'); if (b) selectEvent(b.closest('[data-id]').dataset.id); };
$('evNew').onclick = async () => {
  const r = await run('event.create', { name: 'New event' });
  if (r) { selectEvent(r.id); showTab('event'); toast('Draft created — fill in the details'); $('eName').select(); }
};

const EV = { eName: 'name', eDate: 'date', eTime: 'time', eLoc: 'location', eLink: 'link', eNote: 'note', eRounds: 'rounds',
             eMatch: 'matchSeconds', eCd: 'countdownSeconds', eCount: 'countSeconds', eRest: 'restMinutes' };
function renderEvent(d) {
  $('evDetails').classList.toggle('hide', !d.id);
  if (!d.id) return;
  $('evTitle').innerHTML = `Event details ${chipFor(d.status)}`;
  renderIf('event', $('eventFields'), [d.id, d.event], () => {
    for (const [id, k] of Object.entries(EV)) $(id).value = d.event[k] ?? '';
    $('eImgThumb').innerHTML = d.event.image ? `<img class="thumb" src="/media/${esc(d.event.image)}" alt="">` : '';
    $('eImgDel').classList.toggle('hide', !d.event.image);
    $('eImg').value = '';
  });
  const actions = {
    draft:     [['publish', 'Publish', 'b-grn'], ['start', 'Start event', 'pri'], ['delete', '✕', 'danger icon']],
    published: [['unpublish', 'Unpublish', ''], ['start', 'Start event', 'pri'], ['delete', '✕', 'danger icon']],
    live:      [['back', 'Back to upcoming', ''], ['end', 'End event', 'danger']],
  }[d.status] || [];
  renderIf('evActions', $('evActions'), [d.id, d.status], () => {
    $('evActions').innerHTML = actions.map(([a, label, cls]) => `<button class="${cls}" data-status="${a}"${a === 'delete' ? ' title="Delete event"' : ''}>${label}</button>`).join('');
  });
  $('evHelp').textContent = {
    draft: 'Draft — not public. Set it up (robots, bracket) at your own pace; Publish shows it as an upcoming event.',
    published: 'Published — the public sees it as an upcoming event with a countdown (and robot cards once robots are added).',
    live: 'Live — the public sees the event; the fight console and arena lights run it. End event saves it to Past events.',
  }[d.status] || '';
}

$('evActions').onclick = async e => {
  const b = e.target.closest('button[data-status]');
  if (!b) return;
  const d = ev(), name = d.event.name, live = msg.data.liveId && msg.data.byId[msg.data.liveId];
  const go = (status, ok) => run('event.status', { status }, ok);
  switch (b.dataset.status) {
    case 'publish': return go('published', 'Published — shown as upcoming');
    case 'unpublish': return confirm(`Hide "${name}" from the public site again (back to draft)?`) && go('draft', 'Back to draft');
    case 'start':
      if (live && live.id !== d.id) return toast(`"${live.event.name}" is live — end it first`, true);
      if (confirm(`Start "${name}"?\n\nIt becomes the live event: the public page switches from the countdown to the live event, ` +
                  'and the fight console and arena lights run it.') && await go('live', `${name} is live`)) showTab('fight');
      return;
    case 'back': return confirm(`Take "${name}" back to upcoming? Viewers see the countdown again; results are kept.`) && go('published', 'Back to upcoming');
    case 'end':
      if (!confirm(`End "${name}"?\n\nIt moves to Past events with all its results, and the public page goes back to upcoming events.`)) return;
      await go('done', `${name} ended — saved to Past events`);
      return;
    case 'delete':
      if (!confirm(`Delete "${name}" with its robots and bracket?\n\n(It goes to the server's trash, recoverable over SSH.)`)) return;
      await run('event.delete', {}, `Deleted ${name}`);
      return;
  }
};

$('saveEvent').onclick = async () => {
  const a = {};
  for (const [id, k] of Object.entries(EV)) a[k] = $(id).type === 'number' ? Number($(id).value) : $(id).value.trim();
  a.startsAt = a.date ? new Date(`${a.date}T${a.time || '00:00'}`).getTime() || 0 : 0;   // this browser's timezone = the venue's
  if (await run('event.update', a, 'Event saved')) sigs.event = null;
};
$('eImg').onchange = async () => {
  const f = $('eImg').files[0];
  if (!f) return;
  try {
    const data = await resizeImage(f);
    if (await run('event.image', { data }, 'Banner saved')) sigs.event = null;
  } catch (e) { toast(e.message, true); }
};
$('eImgDel').onclick = () => confirm('Remove the banner?') && run('event.image', { data: null }, 'Banner removed').then(() => { sigs.event = null; });

// Shrink to ≤ maxW px wide and re-encode (WebP, JPEG where WebP encoding is missing):
// phone photos become a few hundred KB and any metadata (GPS etc.) is dropped.
async function resizeImage(file, maxW = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image'));
      i.src = url;
    });
    const scale = Math.min(1, maxW / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let data = c.toDataURL('image/webp', 0.85);
    if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.85);
    if (data.length > 2_000_000) throw new Error('Image still too large after resizing');
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Past events ──
function renderPast(data) {
  renderIf('past', $('pastList'), data.archives, () => {
    $('pastList').innerHTML = data.archives.map(a => `<div class="q" data-id="${esc(a.id)}">
      <div><b>${esc(a.name)}</b> <span class="muted">${esc(a.date)}</span><div class="muted">${pastSummary(a)}</div></div>
      <div class="btns"><button class="sm" data-past="view">View</button><button class="sm" data-past="download">Download</button>
        <button class="sm" data-past="restore">Restore</button><button class="sm icon danger" data-past="delete" title="Delete">✕</button></div></div>`).join('') ||
      '<p class="muted">No past events yet. Ending a live event saves it here.</p>';
  });
}

function pastSummary(a) {
  const who = a.champion ? `🏆 ${esc(a.champion)}` : a.finished && a.leaders.length ? `tie: ${a.leaders.map(esc).join(', ')}` : 'not finished';
  return `${who} · ${a.robots} robots · ${a.rounds} rounds · ${a.fights} fights · saved ${new Date(a.archivedAt).toLocaleString()}`;
}

$('pastList').onclick = async e => {
  const b = e.target.closest('button[data-past]');
  if (!b) return;
  const id = b.closest('[data-id]').dataset.id, a = msg.data.archives.find(x => x.id === id);
  if (b.dataset.past === 'view') return window.open(`/?archive=${encodeURIComponent(id)}`, '_blank', 'noopener');
  if (b.dataset.past === 'download') { location.href = `/api/archive/${encodeURIComponent(id)}/export`; return; }
  if (b.dataset.past === 'delete') {
    if (confirm(`Delete the past event "${a.name}" (${a.date})?\n\nIt disappears from the site and the Past events list. Tip: Download it first if you want a copy.`)) {
      await run('archive.delete', { id });   // errors show as a toast; the new state arrives before the reply
      if (!msg.data.archives.some(x => x.id === id)) { toast(`Deleted ${a.name}`); sigs.past = null; }
    }
    return;
  }
  if (!confirm(`Restore "${a.name}" as a draft event?\n\nIts robots, bracket and results come back; the past-event copy stays.`)) return;
  const r = await run('archive.restore', { id });
  if (r) { selectEvent(r.id); toast(`Restored ${a.name} as a draft`); }
};

function renderLed(l) {
  const chip = $('ledChip'), st = $('ledState');
  const text = !l.enabled ? 'LEDs not configured' : l.connected ? `LEDs online${l.rtt != null ? ' · ' + l.rtt + ' ms' : ''}` : 'LEDs offline';
  for (const c of [chip, st]) { c.textContent = text; c.className = c.className.replace(/ ?(ok|bad)/g, '') + (l.connected ? ' ok' : ' bad'); }
  const ago = l.since ? fmtClock(Date.now() - l.since) : '—';
  const rows = l.connected ? [['Scene', l.label || '—'], ['Round trip', l.rtt != null ? l.rtt + ' ms' : '—'],
    ['Connected for', ago], ['From', l.remote], ['Firmware', l.fw || '—'], ['WiFi', l.rssi ? l.rssi + ' dBm' : '—'],
    ['Free heap', l.heap ? (l.heap / 1024).toFixed(0) + ' KB' : '—'], ['Groups', l.groups.join(', ') || '—']]
    : [['Status', l.enabled ? 'Waiting for the driver to connect' : 'Set LED_KEY on the server to enable']];
  if (l.lastError) rows.push(['Last error', l.lastError]);
  $('ledInfo').innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${esc(v)}</span>`).join('');
  document.querySelectorAll('[data-scene]').forEach(b => b.disabled = !l.connected);
  $('ledUrl').textContent = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/led`;
}
document.querySelectorAll('[data-scene]').forEach(b => b.onclick = () => run('led.scene', { name: b.dataset.scene }));
$('export').onclick = () => { if (sel) location.href = `/api/export?ev=${encodeURIComponent(sel)}`; };
