// Broadcast ranking (/obs/ranking): the standings table — position, robot, team,
// wins, losses, KOs, Buchholz. Robots in the arena / up next are tagged; rows slide
// to their new place when a result changes the order.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
//
// URL options: top=N  only the first N robots · cols=1|2 (default: 2 when more than 10 robots) · bg= (see obs.js)
import { eventResult } from './live.js';
import { $, esc, opt, stage, follow, avatar, eventTitle, statusLine, onDeck, setHtml } from './obs.js';

stage('dark');
$('host').textContent = location.host;
const body = $('body');
follow(d => draw(d));

function draw(d) {
  if (!d) {
    $('evTitle').textContent = 'WPFL';
    $('title').textContent = 'Ranking';
    $('status').innerHTML = '';
    $('note').textContent = '';
    return setHtml(body, '<div class="empty">No event on air</div>');
  }
  const robots = new Map(d.robots.map(r => [r.id, r]));
  const res = eventResult(d);
  const deck = onDeck(d);
  const started = d.standings.some(s => s.played + s.byes > 0);
  $('evTitle').textContent = eventTitle(d);
  $('title').textContent = res.finished ? 'Final ranking' : 'Ranking';
  $('status').innerHTML = statusLine(d, res.finished);
  $('note').textContent = started ? 'Ranked by wins · then Buchholz (opponents’ wins) · then fewest losses'
    : 'No results yet · robots in alphabetical order';

  let list = d.standings.slice().sort((a, b) => a.dropped - b.dropped);   // keeps the server's order otherwise
  const top = Number(opt.get('top'));
  if (top > 0) list = list.slice(0, top);
  const cols = Number(opt.get('cols')) === 1 || Number(opt.get('cols')) === 2 ? Number(opt.get('cols')) : list.length > 10 ? 2 : 1;
  const per = Math.max(1, Math.ceil(list.length / cols));

  const row = s => {
    const r = robots.get(s.id) || { name: s.name };
    const ranked = s.played + s.byes > 0;
    const champ = res.clear && res.champion?.id === s.id;
    const tier = ranked && !s.dropped && s.rank <= 3 ? ` t${s.rank}` : '';
    const tag = s.dropped ? '<span class="tag out">OUT</span>' : champ ? '<span class="tag champ">CHAMPION</span>'
      : deck.live.has(s.id) ? '<span class="tag live">LIVE</span>' : deck.next.has(s.id) ? '<span class="tag next">NEXT</span>' : '';
    const by = r.team || r.builder || '';
    return `<div class="rk-row${tier}${s.dropped ? ' out' : ''}${champ ? ' champ' : ''}" data-id="${esc(s.id)}">
      <span class="rk-pos">${ranked ? s.rank : '–'}</span>${avatar(r)}
      <div class="rk-who"><div class="rk-nm"><b>${esc(r.name)}</b>${tag}</div>${by ? `<span class="rk-by">${esc(by)}</span>` : ''}</div>
      <span class="rk-v w">${s.wins}</span><span class="rk-v l">${s.losses}</span><span class="rk-v">${s.ko}</span><span class="rk-v b">${s.buchholz}</span></div>`;
  };
  const head = '<div class="rk-h"><span>#</span><span></span><span>Robot</span><span>W</span><span>L</span><span>KO</span><span>BHZ</span></div>';
  const html = list.length ? Array.from({ length: cols }, (_, c) =>
    `<div class="rk-col">${head}${list.slice(c * per, (c + 1) * per).map(row).join('')}</div>`).join('')
    : '<div class="empty">No robots yet</div>';

  // FLIP: remember where each robot was, redraw, then slide rows from there.
  const before = new Map([...body.querySelectorAll('.rk-row')].map(e => [e.dataset.id, [e.offsetLeft, e.offsetTop]]));
  body.style.setProperty('--cols', cols);
  if (!setHtml(body, html)) return;
  const h = body.clientHeight - 44;
  const rowh = Math.min(108, Math.floor(h / per));
  body.style.setProperty('--rowh', rowh + 'px');
  body.style.setProperty('--avs', rowh - 18 + 'px');
  body.style.setProperty('--fs', Math.round(Math.max(18, Math.min(38, rowh * 0.42))) + 'px');
  body.style.setProperty('--rk', Math.round(Math.max(40, Math.min(64, rowh * 0.75))) + 'px');
  body.style.setProperty('--nw', (cols === 1 ? 100 : 56) + 'px');
  for (const e of body.querySelectorAll('.rk-row')) {
    const p = before.get(e.dataset.id);
    if (!p) continue;
    const dx = p[0] - e.offsetLeft, dy = p[1] - e.offsetTop;
    if (dx || dy) e.animate([{ transform: `translate(${dx}px,${dy}px)`, zIndex: 2 }, { transform: 'none', zIndex: 2 }],
                            { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}
