// Public viewer: live fight, upcoming fights, rounds and standings.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
import { $, esc, connect, fightCard, matchRow, bracketGraphic, followRobots, eventResult, rankRows, battlecards, flipCards } from './live.js';
// Battlecards turn over on click (Robots tab and upcoming-event grid).
flipCards($('cards'));
flipCards($('nextCards'));

const RULES_URL = 'https://wpfl.thehomelab.dev/';

let msg = null, roundsSig = '', cardsSig = '', conn = null, finalShown = false;
const FINAL_DELAY_MS = 8000;   // the last fight's winner stays up this long before the final ranking
const updateFight = fightCard($('liveCard'));
const follow = followRobots($('rounds'), () => showFollow());

// /?archive=<id> → a past event, loaded once and read-only. Otherwise: live.
const archiveId = new URLSearchParams(location.search).get('archive');
if (archiveId) {
  $('dot').classList.add('hide');
  fetch(`/api/archive/${encodeURIComponent(archiveId)}`).then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      msg = { data, serverNow: Date.now() };
      const saved = data.archivedAt ? ` · saved ${new Date(data.archivedAt).toLocaleDateString()}` : '';
      $('pastBanner').innerHTML = `<div class="head"><span><span class="chip">Past event</span> <b>${esc(data.event.name)}</b>
        <span class="muted">${esc(data.event.date)}${saved}</span></span><a href="/">← Back to the live event</a></div>`;
      $('pastBanner').classList.remove('hide');
      render();
    })
    .catch(() => { $('pastBanner').innerHTML = 'That past event was not found. <a href="/">Back to the live event</a>'; $('pastBanner').classList.remove('hide'); });
} else {
  conn = connect({ onState: m => { msg = m; render(); }, onStatus: on => $('dot').classList.toggle('on', on) });
}

document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('sel', x === b));
  ['live', 'rounds', 'standings', 'robots'].forEach(t => $('tab-' + t).classList.toggle('hide', t !== b.dataset.tab));
});
// Every visit starts on Live (a #robot-<id> link still opens its battlecard).

const names = d => Object.fromEntries(d.robots.map(r => [r.id, r.name]));
const records = d => Object.fromEntries(d.standings.map(s => [s.id, `${s.wins}–${s.losses}`]));

function render() {
  const d = msg.data;
  // No live event: Live shows the next upcoming event (+ past events); other tabs hidden.
  const published = d.mode !== 'upcoming';
  document.querySelectorAll('nav button:not([data-tab="live"])').forEach(b => b.classList.toggle('hide', !published));
  $('upcomingView').classList.toggle('hide', published);
  if (!published) {
    document.querySelector('nav button[data-tab="live"]').click();
    $('liveView').classList.add('hide');
    $('finalView').classList.add('hide');
    finalShown = false;
    return renderUpcoming(d);
  }
  const n = names(d), liveId = d.live && d.live.phase !== 'done' ? d.live.fightId : null;   // a decided fight shows its result
  document.title = `${d.event.name} — Live`;
  $('evName').textContent = d.event.name;

  // Event decided → final results only, unless a fight is ready/running in the arena.
  const res = eventResult(d), final = showFinal(d, res);
  finalShown = final;
  $('liveView').classList.toggle('hide', final);
  $('finalView').classList.toggle('hide', !final);
  if (final) renderFinal(d, res);

  $('liveCard').classList.toggle('hide', !d.live);
  $('idleCard').classList.toggle('hide', !!d.live);
  const next = d.queue.filter(q => q.id !== liveId).map(q => d.fights.find(f => f.id === q.id));
  if (!d.live) {
    $('idleText').innerHTML = next.length
      ? `Next: <b class="tr">${esc(n[next[0].red])}</b> vs <b class="tb">${esc(n[next[0].blue])}</b>`
      : res.finished && res.leaders.length > 1
        ? `All rounds are done — tie for first between ${res.leaders.map(s => `<b>${esc(s.name)}</b>`).join(' and ')}. A tiebreaker is coming up.`
        : archiveId ? 'This event was saved before it finished.'
        : d.fights.length ? 'Waiting for the next round…' : 'Brackets will appear here once the referee starts round 1.';
  }
  $('ranking').innerHTML = rankRows(d.standings.filter(s => s.played + s.byes > 0).slice(0, 8));
  const csig = JSON.stringify([d.robots, d.fights, d.standings, d.queue.map(q => q.id), liveId]);
  if (csig !== cardsSig) { cardsSig = csig; $('cards').innerHTML = battlecards(d); filterCards(); focusCard(); }
  $('pastCard').classList.toggle('hide', !d.archives?.length);
  $('pastList').innerHTML = pastRows(d.archives);
  $('upNext').innerHTML = next.slice(0, 5).map(f => matchRow(f, n, liveId, true)).join('') || '<p class="muted">Nothing scheduled.</p>';
  const done = d.fights.filter(f => f.status === 'done' && f.method !== 'bye').sort((a, b) => b.endedAt - a.endedAt);
  $('recent').innerHTML = done.slice(0, 5).map(f => matchRow(f, n, liveId, true)).join('') || '<p class="muted">No results yet.</p>';

  const sig = JSON.stringify([d.rounds, d.fights, n, liveId]);
  if (sig !== roundsSig) {
    roundsSig = sig;
    $('rounds').innerHTML = bracketGraphic(d, n, liveId);
    follow.refresh();
  }
  showFollow();

  $('table').innerHTML = d.standings.map(s => `<tr${s.dropped ? ' class="muted"' : ''}><td class="n">${s.rank}</td>
    <td>${esc(s.name)}${s.dropped ? ' <span class="tag">out</span>' : ''}</td><td class="n">${s.wins}</td><td class="n">${s.losses}</td>
    <td class="n">${s.buchholz}</td><td class="n">${s.ko}</td></tr>`).join('') ||
    '<tr><td colspan="6" class="muted">No robots yet.</td></tr>';
  tick();
}

// "Following X · 3–1 · #2" above the bracket (tap a robot to pin it).
function showFollow() {
  const id = follow.pinned(), s = id && msg?.data.standings.find(x => x.id === id);
  $('follow').innerHTML = s
    ? `<span class="chip ok">Following</span><b>${esc(s.name)}</b><span class="muted">${s.wins}–${s.losses} · rank #${s.rank} · tap again to clear</span>
       <a href="#robot-${s.id}">Battlecard →</a>`
    : '<span class="muted">Hover or tap a robot to follow it through the rounds. ✓ = winner.</span>';
}

function renderFinal(d, res) {
  const robot = id => d.robots.find(r => r.id === id) || {};
  const c = res.champion, cr = robot(c.id);
  $('champTitle').textContent = `${d.event.name} — Champion`;
  $('champName').textContent = c.name;
  $('champMeta').textContent = [`${c.wins}–${c.losses}`, cr.builder && `built by ${cr.builder}`, cr.team].filter(Boolean).join(' · ');
  const top = d.standings.filter(s => !s.dropped).slice(0, 3);
  // Height and medal follow the rank, so a tie for 2nd stands on two equal blocks.
  const pod = s => s ? `<div class="pod p${Math.min(s.rank, 3)}"><span class="medal m${Math.min(s.rank, 3)}">${s.rank}</span><b>${esc(s.name)}</b>
    <span class="muted">${s.wins}–${s.losses}</span></div>` : '<div></div>';
  $('podium').innerHTML = pod(top[1]) + pod(top[0]) + pod(top[2]);   // 2nd · 1st · 3rd
  $('finalSub').textContent = `${d.rounds.length} rounds · ${d.fights.filter(f => f.status === 'done' && f.method !== 'bye').length} fights`;
  $('finalTable').innerHTML = d.standings.map(s => `<tr${s.dropped ? ' class="muted"' : ''}><td class="n"><span class="medal m${s.rank <= 3 ? s.rank : 0}">${s.rank}</span></td>
    <td><b>${esc(s.name)}</b>${s.dropped ? ' <span class="tag">out</span>' : ''}</td><td class="muted hide-s">${esc(robot(s.id).builder || '')}</td>
    <td class="n">${s.wins}</td><td class="n">${s.losses}</td><td class="n">${s.buchholz}</td><td class="n hide-s">${s.ko}</td></tr>`).join('');
}

// ── Battlecards: search, deep links (#robot-<id>) ──
function filterCards() {
  const q = $('bcFilter').value.trim().toLowerCase();
  let n = 0;
  document.querySelectorAll('#cards .bc').forEach(c => { const on = !q || c.dataset.name.includes(q); c.classList.toggle('hide', !on); n += on; });
  $('bcCount').textContent = msg ? `${n} of ${msg.data.robots.filter(r => !r.hideCard).length} robots` : '';
}
$('bcFilter').oninput = filterCards;

function focusCard() {
  const m = /^#robot-([\w-]+)$/.exec(location.hash);
  if (!m) return;
  const card = document.getElementById('robot-' + m[1]);
  if (!card) return;
  document.querySelector('nav button[data-tab="robots"]').click();
  $('bcFilter').value = ''; filterCards();
  document.querySelectorAll('#cards .bc.focus').forEach(c => c.classList.remove('focus'));
  card.classList.add('focus');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.addEventListener('hashchange', focusCard);
$('liveCard').addEventListener('click', e => {
  const side = e.target.closest('.side[data-id]');
  if (side) location.hash = 'robot-' + side.dataset.id;
});

const pastRows = list => (list || []).map(a => `<div class="past"><div><a href="/?archive=${encodeURIComponent(a.id)}"><b>${esc(a.name)}</b></a>
  <span class="muted">${esc(a.date)}</span></div><span class="muted">${a.champion ? `🏆 ${esc(a.champion)}` : 'no single winner'}</span></div>`).join('');

// "Saturday, October 24, 2026 · 4:00 PM" — straight from the date and time fields
// (venue time), so no timezone can shift the day.
function when(e, long = true) {
  if (!e.date) return '';
  const day = new Date(e.date + 'T12:00:00').toLocaleDateString(undefined, long
    ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
  if (!e.time) return day;
  const [h, m] = e.time.split(':').map(Number);
  return `${day} · ${new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
// Countdown target: the exact start (set by the referee's browser) when a time is
// given, otherwise the start of that day here.
const startOf = e => e.time && e.startsAt ? e.startsAt : e.date ? new Date(e.date + 'T00:00:00').getTime() : 0;

let upSig = '';
function renderUpcoming(d) {
  const next = d.next, e = next?.event;
  document.title = e ? `WPFL — ${e.name}` : 'WPFL — Upcoming events';
  $('evName').textContent = e ? e.name : 'Upcoming events';
  const sig = JSON.stringify([next?.event, next?.robots, d.upcoming, d.archives]);
  if (sig === upSig) return;
  upSig = sig;

  $('nextHero').innerHTML = !e ? `<div class="hero-body"><h2>Upcoming events</h2>
      <p class="lead">No upcoming events announced yet — check back soon.</p>
      <a class="hero-link" href="${RULES_URL}" target="_blank" rel="noopener">Rules &amp; info →</a></div>` : `
    ${e.image ? `<img class="hero-img" src="/media/${esc(e.image)}" alt="${esc(e.name)}">` : ''}
    <div class="hero-body">
      <span class="chip ok">Next event</span>
      <h1 class="hero-name">${esc(e.name)}</h1>
      <div class="hero-meta">${[when(e), e.location].filter(Boolean).map(esc).join(' · ')}</div>
      ${e.note ? `<p class="hero-note">${esc(e.note)}</p>` : ''}
      ${startOf(e) ? `<div class="countdown" id="countdown"><div><b data-cd="d">–</b><span>days</span></div>
        <div><b data-cd="h">–</b><span>hours</span></div><div><b data-cd="m">–</b><span>min</span></div>
        <div><b data-cd="s">–</b><span>sec</span></div></div><p class="lead hide" id="cdSoon">Starting soon — stay tuned!</p>` : ''}
      <div class="btns">${e.link ? `<a class="hero-link" href="${esc(e.link)}" target="_blank" rel="noopener">Registration &amp; info →</a>` : ''}
        <a href="${RULES_URL}" target="_blank" rel="noopener">Rules</a></div>
    </div>`;

  const robots = next?.robots.filter(r => !r.hideCard).length || 0;
  $('nextRobotsCard').classList.toggle('hide', !robots);
  $('nextRobotsCount').textContent = robots ? `${robots} registered` : '';
  if (robots) $('nextCards').innerHTML = battlecards(next);

  const later = d.upcoming.filter(u => u.id !== next?.id);
  $('laterCard').classList.toggle('hide', !later.length);
  $('upList').innerHTML = later.map(u => {
    const dt = new Date((u.date || '2000-01-01') + 'T12:00:00');
    return `<article class="up"><div class="up-date"><b>${dt.getDate() || '?'}</b><span>${esc(dt.toLocaleDateString(undefined, { month: 'short' }))}</span>
        <small>${dt.getFullYear() || ''}</small></div>
      <div class="up-body"><h3>${esc(u.name)}</h3><div class="muted">${[when(u, false), u.location].filter(Boolean).map(esc).join(' · ')}</div>
        ${u.note ? `<p>${esc(u.note)}</p>` : ''}${u.link ? `<a class="up-link" href="${esc(u.link)}" target="_blank" rel="noopener">Details →</a>` : ''}</div></article>`;
  }).join('');
  $('upPastCard').classList.toggle('hide', !d.archives.length);
  $('upPast').innerHTML = pastRows(d.archives);
  tickCountdown();
}

// Days / hours / minutes / seconds to the next event's start (server clock).
function tickCountdown() {
  const e = msg?.data.mode === 'upcoming' && msg.data.next?.event;
  if (!e || !startOf(e) || !$('countdown')) return;
  const left = startOf(e) - (conn ? conn.now() : Date.now());
  $('countdown').classList.toggle('hide', left <= 0);
  $('cdSoon').classList.toggle('hide', left > 0);
  if (left <= 0) return;
  const s = Math.floor(left / 1000);
  const parts = { d: Math.floor(s / 86400), h: Math.floor(s / 3600) % 24, m: Math.floor(s / 60) % 60, s: s % 60 };
  for (const [k, v] of Object.entries(parts)) {
    const el = document.querySelector(`[data-cd="${k}"]`);
    const txt = k === 'd' ? String(v) : String(v).padStart(2, '0');
    if (el.textContent !== txt) el.textContent = txt;
  }
}

// Final view when the event is decided (all rounds done, one leader) and the arena is
// empty — or only holds a finished fight whose result has been up for FINAL_DELAY_MS.
function showFinal(d, res = eventResult(d)) {
  if (!res.clear) return false;
  if (!d.live) return true;
  if (d.live.phase !== 'done') return false;            // a tiebreak/exhibition is on: show it
  const ended = d.fights.find(f => f.id === d.live.fightId)?.endedAt || 0;
  return (conn ? conn.now() : Date.now()) - ended >= FINAL_DELAY_MS;
}

function tick() {
  tickCountdown();
  if (msg?.data.live && conn) updateFight(msg.data.live, msg.serverNow, conn.now(), records(msg.data));
  if (msg && !finalShown && showFinal(msg.data)) render();   // the delay ran out between state pushes
}
setInterval(tick, 100);
