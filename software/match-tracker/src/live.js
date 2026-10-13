// Live fight controller: the one fight currently in the arena.
// Owns the match clock (server time is the truth), the start/resume countdown,
// the 10 s incapacitation/pin count, and the arena lights for each phase.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
//
// PHASES
//   ready ──start──► countdown ──(N s)──► running ──(time)──► time ──end──► done
//                        ▲                  │  ▲                              │
//                        └────resume──── paused ┘ (pause / stop)        unload / load next
//   end() is allowed from any phase (KO, forfeit, judges' decision).
//
// LIGHTS (LED driver protocol v1, docs/protocols/arena-led-websocket.md)
//   ready → yellow · countdown → driver countdown · running → the driver's "After GO" color
//   pause → yellow · stop → red · 30 s left → white blink on the ceiling · time → red
//   fault → side blinks yellow 3 s · count → 10 s countdown on that side · winner → color + sparkle
//   nothing loaded → rainbow
import { fightById, setResult, SIDES, METHODS } from './tournament.js';

const fail = msg => { throw new Error(msg); };

export const LED = {
  idle:    () => [{ type: 'effect', fx: 'rainbow', period: 6000, label: 'idle' }],
  ready:   () => [{ type: 'solid', color: 'yellow', label: 'ready' }],
  fight:   (color = 'green') => [{ type: 'solid', color, label: 'fight' }],
  pause:   () => [{ type: 'solid', color: 'yellow', label: 'pause' }],
  stop:    () => [{ type: 'solid', color: 'red', label: 'stop' }],
  time:    () => [{ type: 'solid', color: 'red', label: 'time' }],
  countdown: s => [{ type: 'countdown', seconds: s, label: 'countdown' }],
  warn30:  () => [{ type: 'effect', fx: 'blink', target: 'ceiling', color: 'white', color2: 'off', period: 400,
                    duration: 1200, overlay: true }],
  fault:   side => [{ type: 'effect', fx: 'blink', target: side, color: 'yellow', color2: 'off', period: 300,
                      duration: 3000, overlay: true }],
  count:   (side, s) => [{ type: 'countdown', target: side, seconds: s, warnAt: 3, high: 'yellow', warn: 'red',
                           go: 'red', then: 'none', label: 'count' }],
  cancel:  side => [{ type: 'cancel', target: side }],
  wins:    side => [{ type: 'solid', color: side, label: `${side} wins` },
                    { type: 'effect', fx: 'sparkle', color: 'white', color2: side, period: 90, duration: 6000, overlay: true }],
};

export class LiveFight {
  // store: { doc } = the live event (null when none is live) · led: { send(cmd) }
  // onChange(): persist + broadcast · clock(): epoch ms
  constructor({ store, led, onChange = () => {}, clock = Date.now }) {
    Object.assign(this, { store, led, onChange, clock });
  }

  get doc() { return this.store.doc; }
  get live() { return this.doc ? this.doc.live : null; }
  get matchMs() { return this.doc.event.matchSeconds * 1000; }

  lights(cmds) { for (const c of cmds) this.led.send(c); }
  fightScene() { return LED.fight(this.led.fightColor || 'green'); }
  changed() { this.onChange(); }

  fight() {
    const l = this.live;
    return l ? fightById(this.doc, l.fightId) : null;
  }

  elapsed(now = this.clock()) {
    const l = this.live;
    if (!l) return 0;
    return Math.min(this.matchMs, l.elapsedMs + (l.runningSince ? now - l.runningSince : 0));
  }

  // ── Referee actions ──────────────────────────────────────────────────────
  load(fightId) {
    if (!this.doc) fail('No event is live — press Start event in the Event tab first');
    const f = fightById(this.doc, fightId) || fail('Unknown fight in the live event');
    if (f.status !== 'pending' || !f.blue) fail('Only pending fights can be loaded');
    if (this.inProgress()) fail('A fight is in progress — end or unload it first');
    this.doc.live = { fightId: f.id, phase: 'ready', elapsedMs: 0, runningSince: null, countdownEndsAt: null,
                      count: null, warned30: false, stopped: false };
    this.lights(LED.ready());
    this.changed();
  }

  inProgress() {
    return !!this.live && ['countdown', 'running', 'paused'].includes(this.live.phase);
  }

  start(now = this.clock()) {
    const l = this.live || fail('Load a fight first');
    if (!['ready', 'paused'].includes(l.phase)) fail(`Cannot start while ${l.phase}`);
    const f = this.fight();
    if (l.phase === 'ready') f.startedAt = now;
    l.stopped = false;
    const cd = this.doc.event.countdownSeconds;
    if (cd > 0) {
      l.phase = 'countdown';
      l.countdownEndsAt = now + cd * 1000;
      this.lights(LED.countdown(cd));
    } else {
      l.phase = 'running';
      l.runningSince = now;
      this.lights(this.fightScene());
    }
    this.changed();
  }

  pause(stop = false, now = this.clock()) {
    const l = this.live || fail('No fight loaded');
    if (!['countdown', 'running', 'paused'].includes(l.phase)) fail(`Cannot pause while ${l.phase}`);
    l.elapsedMs = this.elapsed(now);
    Object.assign(l, { phase: 'paused', runningSince: null, countdownEndsAt: null, count: null, stopped: stop });
    this.lights(stop ? LED.stop() : LED.pause());   // a solid fill also clears any count on the driver
    this.changed();
  }

  fault(side) {
    const l = this.live || fail('No fight loaded');
    if (!SIDES.includes(side)) fail('Side must be red or blue');
    if (l.phase === 'done') fail('Fight is over');
    this.fight().faults[side]++;
    this.lights(LED.fault(side));
    this.changed();
  }

  // kind: 'ko' (incapacitated, rules E.4) or 'pin' (pin/hold limit)
  count(side, kind = 'ko', now = this.clock()) {
    const l = this.live || fail('No fight loaded');
    if (!SIDES.includes(side)) fail('Side must be red or blue');
    if (l.phase !== 'running') fail('Counts only run during the fight');
    if (l.count) this.lights(LED.cancel(l.count.side));
    // Within the driver's GO flash (2 s) the start countdown still owns the
    // arena; a count would trim that side out of it and later fall back to
    // the "ready" base. Settle the whole arena into the fight scene first.
    else if (now - l.runningSince < 2500) this.lights(this.fightScene());
    const s = this.doc.event.countSeconds;
    l.count = { side, kind: kind === 'pin' ? 'pin' : 'ko', endsAt: now + s * 1000, expired: false };
    this.lights(LED.count(side, s));
    this.changed();
  }

  cancelCount() {
    const l = this.live;
    if (!l || !l.count) return;
    this.lights(LED.cancel(l.count.side));
    l.count = null;
    this.changed();
  }

  end(winner, method, now = this.clock()) {
    const l = this.live || fail('No fight loaded');
    if (!SIDES.includes(winner)) fail('Winner must be red or blue');
    if (!METHODS.includes(method) || method === 'bye') fail('Method must be ko, judges or forfeit');
    const f = this.fight();
    l.elapsedMs = this.elapsed(now);
    setResult(this.doc, { id: f.id, winner, method }, now);
    f.endedAt = now;
    f.durationMs = l.elapsedMs;
    Object.assign(l, { phase: 'done', runningSince: null, countdownEndsAt: null, count: null, stopped: false });
    this.lights(LED.wins(winner));
    this.changed();
  }

  // Clear the arena. A fight unloaded before its result stays pending.
  unload() {
    if (!this.live) return;
    this.doc.live = null;
    this.lights(LED.idle());
    this.changed();
  }

  // ── Clock ────────────────────────────────────────────────────────────────
  // Call often (every ~100 ms). Advances phases on time.
  tick(now = this.clock()) {
    const l = this.live;
    if (!l) return;
    let dirty = false;
    if (l.phase === 'countdown' && now >= l.countdownEndsAt) {
      // The driver's countdown ends in its own GO → "then" color; nothing to send.
      Object.assign(l, { phase: 'running', runningSince: l.countdownEndsAt, countdownEndsAt: null });
      dirty = true;
    }
    if (l.phase === 'running') {
      const left = this.matchMs - this.elapsed(now);
      if (!l.warned30 && this.matchMs > 45000 && left <= 30000) {
        l.warned30 = true;
        this.lights(LED.warn30());
        dirty = true;
      }
      if (left <= 0) {
        Object.assign(l, { phase: 'time', elapsedMs: this.matchMs, runningSince: null, count: null });
        this.lights(LED.time());
        dirty = true;
      }
    }
    if (l.count && !l.count.expired && now >= l.count.endsAt) { l.count.expired = true; dirty = true; }
    if (l.count && l.count.expired && now >= l.count.endsAt + 3000) { l.count = null; dirty = true; }
    if (dirty) this.changed();
  }

  // Lights for the current phase — re-sent when the LED driver (re)connects.
  scene(now = this.clock()) {
    const l = this.live;
    if (!l) return LED.idle();
    switch (l.phase) {
      case 'ready': return LED.ready();
      case 'countdown': {
        const s = Math.ceil((l.countdownEndsAt - now) / 1000);
        return s > 0 ? LED.countdown(s) : this.fightScene();
      }
      case 'running': return this.fightScene();
      case 'paused': return l.stopped ? LED.stop() : LED.pause();
      case 'time': return LED.time();
      case 'done': return [LED.wins(this.fight().winner)[0]];
      default: return LED.idle();
    }
  }

  // What viewers need to draw the current fight. Clients extrapolate the clock
  // from `elapsedMs` + `serverNow` while `running` is true.
  snapshot(now = this.clock()) {
    const l = this.live;
    if (!l) return null;
    const f = this.fight();
    const robot = id => this.doc.robots.find(r => r.id === id);
    const side = s => ({ id: f[s], name: robot(f[s])?.name ?? '?', faults: f.faults[s] });
    return {
      fightId: f.id, round: f.round, seq: f.seq, ranked: f.ranked,
      phase: l.phase, stopped: l.stopped, running: l.phase === 'running',
      elapsedMs: this.elapsed(now), matchMs: this.matchMs,
      countdownEndsAt: l.countdownEndsAt, count: l.count,
      red: side('red'), blue: side('blue'),
      winner: f.winner, method: f.method,
    };
  }
}
