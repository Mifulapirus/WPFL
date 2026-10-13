// Referee authentication: one shared password → signed, expiring session cookie.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
import crypto from 'node:crypto';

export const COOKIE = 'wpfl_ref';
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest();

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export class Auth {
  constructor({ password, secret, hours, trustProxy }) {
    this.pwHash = sha256(password);
    this.secret = secret;
    this.ttl = hours * 3600 * 1000;
    this.trustProxy = trustProxy;
    this.attempts = new Map();   // ip → { n, resetAt }
  }

  checkPassword(pw) { return crypto.timingSafeEqual(sha256(pw ?? ''), this.pwHash); }

  sign(exp) { return crypto.createHmac('sha256', this.secret).update(`v1.${exp}`).digest('base64url'); }

  issue(now = Date.now()) {
    const exp = now + this.ttl;
    return { token: `v1.${exp}.${this.sign(exp)}`, maxAge: Math.floor(this.ttl / 1000) };
  }

  verify(token, now = Date.now()) {
    const [v, exp, sig] = String(token || '').split('.');
    if (v !== 'v1' || !exp || !sig || Number(exp) < now) return false;
    const want = Buffer.from(this.sign(exp)), got = Buffer.from(sig);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }

  isReferee(req) { return this.verify(parseCookies(req.headers.cookie)[COOKIE]); }

  clientIp(req) {
    if (this.trustProxy) {
      const xf = req.headers['x-forwarded-for'];
      if (xf) return xf.split(',')[0].trim();
    }
    return req.socket.remoteAddress;
  }

  // 10 failed logins per 10 minutes per IP.
  limited(ip, now = Date.now()) {
    const a = this.attempts.get(ip);
    return !!a && a.resetAt > now && a.n >= 10;
  }

  failed(ip, now = Date.now()) {
    const a = this.attempts.get(ip);
    if (!a || a.resetAt <= now) this.attempts.set(ip, { n: 1, resetAt: now + 10 * 60 * 1000 });
    else a.n++;
  }

  cookie(req, value, maxAge) {
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
}
