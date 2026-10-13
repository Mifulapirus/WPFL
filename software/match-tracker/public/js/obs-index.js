// /obs guide page: one card per broadcast graphic with its link (copy button), options and a live preview.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
import { $, esc, toast } from './live.js';

const SOURCES = [
  { path: '/obs/fight', name: 'Fight bar', what: 'Lower-third for the fight in the arena: both robots with photo, record and faults, the match clock, start countdown, KO / pin counts and the winner. Between fights it shows the next fight, or the latest result when nothing is queued.',
    opts: ['pos=top — bar at the top instead of the bottom', 'idle=hide — no bar when no fight is loaded', 'demo=1 — loop a fake fight (scene setup only)'] , preview: '?demo=1' },
  { path: '/obs/bracket', name: 'Bracket', what: 'The Swiss rounds side by side: every pairing, winners and how they won. The live fight glows, the next one is marked.',
    opts: ['rounds=N — most round columns at once (default 5)', 'bg=transparent | green'] },
  { path: '/obs/ranking', name: 'Ranking', what: 'Standings: position, robot, team, wins, losses, KOs and Buchholz. Rows slide to their new place after each result.',
    opts: ['top=N — only the first N robots (e.g. top=8)', 'cols=1 | 2 — columns (default: 2 above 10 robots)', 'bg=transparent | green'] },
];

$('srcs').innerHTML = SOURCES.map((s, i) => {
  const url = location.origin + s.path;
  return `<div class="card src"><div>
      <h3>${esc(s.name)}</h3><p>${esc(s.what)}</p>
      <div class="url"><input type="text" readonly value="${esc(url)}" aria-label="${esc(s.name)} link"><button class="sm" data-copy="${i}">Copy</button>
        <button class="sm" data-open="${i}">Open</button></div>
      <div class="opts"><span><b>Options</b> — add to the link, e.g. <code>${esc(s.path)}?bg=green</code></span>${s.opts.map(o => `<span>· <code>${esc(o.split(' — ')[0])}</code> ${esc(o.split(' — ')[1] || '')}</span>`).join('')}</div>
    </div><div class="pv"><iframe src="${esc(s.path + (s.preview || ''))}" title="${esc(s.name)} preview" loading="lazy"></iframe></div></div>`;
}).join('');

$('srcs').addEventListener('click', async e => {
  const o = e.target.closest('[data-open]');
  if (o) return open(SOURCES[o.dataset.open].path, '_blank', 'noopener');
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  const url = location.origin + SOURCES[b.dataset.copy].path;
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url); }
});
