// Shared code for the broadcast graphics (/obs/*): OBS browser sources at 1920×1080.
// Each page draws on a fixed 1920×1080 stage scaled to the window, so a source of
// any 16:9 size looks the same. Pages are read-only viewers of the public state.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
//
// URL options (all pages):
//   bg=transparent (default for the fight bar) | dark (default for bracket/ranking) | green (chroma key)
//   demo=1   fake a fight in progress, for setting up scenes before event day (fight bar)
import { connect, $, esc } from './live.js';

export { $, esc };
export const opt = new URLSearchParams(location.search);

// Scale the 1920×1080 stage to the window; background from ?bg=.
export function stage(defaultBg) {
  const bg = opt.get('bg') || defaultBg;
  document.documentElement.dataset.bg = ['transparent', 'dark', 'green'].includes(bg) ? bg : defaultBg;
  const st = $('stage');
  const fit = () => st.style.setProperty('--k', Math.min(innerWidth / 1920, innerHeight / 1080));
  addEventListener('resize', fit);
  fit();
}

// The event on air: the live one, otherwise the next published one (so scenes can be
// set up and rehearsed before the event starts). onEvent(d | null, now()).
export function follow(onEvent) {
  let last = null;
  const conn = connect({
    onState: m => {
      const s = m.data;
      last = { d: s.mode === 'live' ? s : s.next, at: m.serverNow };
      onEvent(last.d, last.at, conn.now());
    },
    onStatus: on => document.documentElement.classList.toggle('offline', !on),
  });
  return { now: () => conn.now(), last: () => last };
}

// Robot picture, or a monogram tile when there is none (or the card is hidden).
// Monogram: first letters of the first two words that carry the name ("Donut of Doom" → DD).
const SMALL = new Set(['of', 'the', 'a', 'an', 'and', 'de', 'la', 'el']);
const initials = n => {
  const words = n.split(/[\s()]+/).filter(Boolean);
  const main = words.filter(w => !SMALL.has(w.toLowerCase()));
  return (main.length ? main : words).slice(0, 2).map(w => [...w][0]).join('').toUpperCase() || '?';
};
export const hue = n => [...n].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7) % 8;
export function avatar(r, cls = 'av') {
  if (!r) return `<span class="${cls} none"></span>`;
  return r.photo
    ? `<span class="${cls}"><img src="/media/${esc(r.photo)}" alt=""></span>`
    : `<span class="${cls} mono h${hue(r.name)}"><b>${esc(initials(r.name))}</b></span>`;
}

// Long robot names: step the font down until the text fits its box (CSSOM, allowed by the CSP).
export function fitText(el, max, min) {
  let size = max;
  el.style.fontSize = size + 'px';
  while (size > min && el.scrollWidth > el.clientWidth + 1) el.style.fontSize = (size -= 2) + 'px';
}

export const eventTitle = d => /wpfl/i.test(d.event.name) ? d.event.name : `WPFL · ${d.event.name}`;

// Round in progress = the latest generated round (0 before the bracket exists).
export const currentRound = d => d.rounds.length ? d.rounds[d.rounds.length - 1].n : 0;

// Header status: LIVE / FINAL / date of an upcoming event, and the round.
export function statusLine(d, finished) {
  const planned = Math.max(d.event.rounds, d.rounds.length), cur = currentRound(d);
  const round = cur ? `<span>Round <b>${cur}</b> of ${planned}</span>` : '';
  if (finished) return `${round}<span class="pill final">FINAL</span>`;
  if (d.status === 'live') return `${round}<span class="pill live">● LIVE</span>`;
  const day = d.event.date ? new Date(`${d.event.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Soon';
  return `${round}<span class="pill soon">${esc(day.toUpperCase())}</span>`;
}

// Robots in the arena now (not after the result) and in the next fight up.
export function onDeck(d) {
  const ids = f => f ? [f.red, f.blue].filter(Boolean) : [];
  const liveF = d.live && d.live.phase !== 'done' ? d.fights.find(f => f.id === d.live.fightId) : null;
  const nextF = d.queue.map(q => d.fights.find(f => f.id === q.id)).find(f => f && f.id !== liveF?.id && f.blue);
  return { liveId: liveF?.id, nextId: nextF?.id, live: new Set(ids(liveF)), next: new Set(ids(nextF)) };
}

// Replace a container's HTML only when it changed (no image flicker on every state push).
const drawn = new WeakMap();
export function setHtml(el, html) {
  if (drawn.get(el) === html) return false;
  el.innerHTML = html;
  drawn.set(el, html);
  return true;
}
