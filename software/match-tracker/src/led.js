// Arena LED driver link.
// The driver sits on the venue network behind NAT, so it dials OUT to this
// server (wss://<host>/led, "Authorization: Bearer <LED_KEY>") and keeps the
// socket open. We send it the same protocol-v1 JSON commands its own web UI
// uses (docs/protocols/arena-led-websocket.md) and read back its state/status.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const PING_MS = 5000;
const STALE_MS = 15000;   // the driver sends status every 2 s; silence = dead link

export class LedLink extends EventEmitter {
  constructor({ key, log = console }) {
    super();
    this.keyHash = key ? crypto.createHash('sha256').update(key).digest() : null;
    this.log = log;
    this.ws = null;
    this.reset();
    this.pingSeq = 0;
    this.pings = new Map();
    setInterval(() => this.ping(), PING_MS).unref();
  }

  reset() {
    Object.assign(this, { since: null, lastMsgAt: 0, ready: false, fightColor: 'green', label: null, fw: null, rssi: null, heap: null, fps: null, groups: [],
                          rtt: null, remote: null, lastError: null });
  }

  get enabled() { return !!this.keyHash; }
  // Ready = the driver has spoken. Its WebSocket client (ESP-IDF 4.4) can drop a
  // message that arrives in the same packet as the handshake reply, so nothing
  // is sent until its hello (config/state/status) has come in.
  get connected() { return !!this.ws && this.ws.readyState === 1 && this.ready; }

  // Constant-time check of "Authorization: Bearer <key>".
  accepts(req) {
    if (!this.keyHash) return false;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return false;
    const got = crypto.createHash('sha256').update(m[1]).digest();
    return crypto.timingSafeEqual(got, this.keyHash);
  }

  attach(ws, remote) {
    if (this.ws) {
      this.log.info?.('[led] replacing previous driver connection');
      this.ws.close(4000, 'replaced');
    }
    this.reset();
    this.ws = ws;
    this.since = this.lastMsgAt = Date.now();
    this.remote = remote;
    this.log.info?.(`[led] driver connected from ${remote}`);
    ws.on('message', (data, isBinary) => { if (!isBinary) this.onMessage(String(data)); });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.log.info?.('[led] driver disconnected');
      this.emit('change');
    });
    ws.on('error', e => this.log.warn?.(`[led] socket error: ${e.message}`));
    this.emit('change');
  }

  onMessage(text) {
    this.lastMsgAt = Date.now();
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!this.ready) {
      this.ready = true;
      this.emit('connected');
      this.emit('change');
    }
    switch (m.type) {
      case 'state':
        if (m.label !== this.label) { this.label = m.label; this.emit('change'); }
        break;
      case 'status':
        Object.assign(this, { fw: m.fw, rssi: m.wifi?.rssi ?? null, heap: m.heap?.free ?? null, fps: m.fps });
        break;
      case 'config': {
        this.groups = (m.layout?.groups || []).map(g => g.name);
        // The driver's own countdown ends in its "After GO" color; use it for the fight scene too.
        const then = m.settings?.countdown?.then;
        this.fightColor = then && then !== 'none' ? then : 'green';
        this.emit('change');
        break;
      }
      case 'pong': {
        const sent = this.pings.get(m.t);
        if (sent) { this.rtt = Date.now() - sent; this.pings.delete(m.t); }
        break;
      }
      case 'error':
        this.lastError = `${m.cmd || 'command'}: ${m.error}`;
        this.log.warn?.(`[led] driver error: ${this.lastError}`);
        this.emit('change');
        break;
    }
  }

  ping() {
    if (!this.connected) return;
    if (Date.now() - this.lastMsgAt > STALE_MS) {
      this.log.warn?.('[led] driver silent — dropping the link');
      this.ws.terminate();
      return;
    }
    const t = ++this.pingSeq % 1000000;   // small integer: survives any JSON number type on the ESP
    this.pings.set(t, Date.now());
    if (this.pings.size > 10) this.pings.delete(this.pings.keys().next().value);
    this.send({ type: 'ping', t });
  }

  // Fire-and-forget (no id → the driver only answers on error). False if offline.
  send(cmd) {
    if (!this.connected) return false;
    this.ws.send(JSON.stringify(cmd));
    return true;
  }

  info() {
    return { enabled: this.enabled, connected: this.connected, since: this.since, fightColor: this.fightColor, label: this.label, fw: this.fw,
             rssi: this.rssi, heap: this.heap, fps: this.fps, rtt: this.rtt, groups: this.groups,
             remote: this.remote, lastError: this.lastError };
  }
}
