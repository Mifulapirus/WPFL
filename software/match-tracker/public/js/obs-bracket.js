// Broadcast bracket (/obs/bracket): the Swiss rounds side by side, one column per
// round, every fight as a two-robot card. Live fight glows, the next one is marked,
// rounds not paired yet show as placeholders.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
//
// URL options: rounds=N  most columns to show (default 5; the window follows the current round) · bg= (see obs.js)
import { METHOD, eventResult } from './live.js';
import { $, esc, opt, stage, follow, avatar, eventTitle, currentRound, statusLine, onDeck, setHtml } from './obs.js';

stage('dark');
$('host').textContent = location.host;
$('title').textContent = 'Swiss bracket';
const body = $('body');
follow(d => draw(d));

function draw(d) {
  if (!d) {
    $('evTitle').textContent = 'WPFL';
    $('status').innerHTML = '';
    $('note').textContent = '';
    return setHtml(body, '<div class="empty">No event on air</div>');
  }
  const robots = new Map(d.robots.map(r => [r.id, r]));
  const res = eventResult(d);
  const deck = onDeck(d);
  $('evTitle').textContent = eventTitle(d);
  $('status').innerHTML = statusLine(d, res.finished);
  $('note').textContent = 'Every round pairs robots with the same record · a bye counts as a win';

  const planned = Math.max(d.event.rounds, d.rounds.length, 1), cur = currentRound(d);
  const max = Math.max(1, Math.min(8, Number(opt.get('rounds')) || 5));
  const start = Math.max(0, Math.min(planned - max, cur - 2));
  const shown = Array.from({ length: Math.min(max, planned) }, (_, i) => start + i + 1);
  const fightsOf = n => d.fights.filter(f => f.round === n).sort((a, b) => a.seq - b.seq);
  const rows = Math.max(1, ...shown.map(n => fightsOf(n).length));

  const player = (f, s) => {
    const id = f[s];
    if (!id) return '<div class="bk-p bye"><span class="nm">Bye</span></div>';
    const r = robots.get(id) || { name: '?' };
    const done = f.status === 'done' && f.method !== 'bye';
    const cls = f.winner === s ? ' w' : done ? ' l' : '';
    const mark = f.winner === s ? `<span class="rs">✓ ${esc(METHOD[f.method] || '')}</span>` : '';
    return `<div class="bk-p ${s}${cls}">${avatar(r)}<span class="nm">${esc(r.name)}</span>${mark}</div>`;
  };
  const card = f => {
    const tag = f.id === deck.liveId ? '<span class="tag live">LIVE</span>' : f.id === deck.nextId ? '<span class="tag next">NEXT</span>' : '';
    const cls = (f.id === deck.liveId ? ' live' : f.id === deck.nextId ? ' next' : '') + (f.ranked === false ? ' exh' : '');
    return `<div class="bk-m${cls}"><span class="bk-n">${f.seq}</span><div class="bk-box">${player(f, 'red')}${player(f, 'blue')}</div>${tag}</div>`;
  };
  const html = shown.map(n => {
    if (!d.rounds.some(r => r.n === n)) {
      return `<section class="bk-col"><h2>Round ${n}<small>Not paired yet</small></h2>
        <div class="bk-tbd">Pairings after<br>round ${n - 1}</div></section>`;
    }
    const fights = fightsOf(n), left = fights.filter(f => f.status !== 'done').length;
    const state = left ? (n === cur ? 'now' : '') : 'done';
    return `<section class="bk-col ${state}"><h2>Round ${n}<small>${left ? `${left} to go` : 'Complete'}</small></h2>
      <div class="bk-list">${fights.map(card).join('')}</div></section>`;
  }).join('');
  setHtml(body, html);

  // Size the cards to the tallest round: every round's cards line up, up to a comfortable maximum.
  const list = body.querySelector('.bk-list');
  const gap = rows > 8 ? 10 : 14;
  const h = list ? list.clientHeight : 800;
  const rowh = Math.min(132, Math.floor((h - gap * (rows - 1)) / rows));
  body.style.setProperty('--gap', gap + 'px');
  body.style.setProperty('--rowh', rowh + 'px');
  body.style.setProperty('--avs', Math.max(18, Math.floor(rowh / 2) - 14) + 'px');
  body.style.setProperty('--fs', Math.round(Math.max(16, Math.min(30, rowh * 0.23))) + 'px');
}
