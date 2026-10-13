// Runtime configuration from environment variables (see .env.example).
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(root, env.DATA_DIR || 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const cfg = {
    root,
    dataDir,
    port: Number(env.PORT) || 3110,
    host: env.HOST || '127.0.0.1',
    refereePassword: env.REFEREE_PASSWORD || '',
    ledKey: env.LED_KEY || '',
    trustProxy: env.TRUST_PROXY === '1',
    sessionHours: Number(env.SESSION_HOURS) || 14,
    sessionSecret: env.SESSION_SECRET || '',
  };

  if (cfg.refereePassword.length < 6) {
    throw new Error('REFEREE_PASSWORD must be set (at least 6 characters)');
  }
  if (cfg.ledKey && cfg.ledKey.length < 16) {
    throw new Error('LED_KEY must be at least 16 characters (or empty to disable the LED link)');
  }
  // No secret given → keep one in the data dir so sessions survive restarts.
  if (!cfg.sessionSecret) {
    const file = path.join(dataDir, '.session-secret');
    try {
      cfg.sessionSecret = fs.readFileSync(file, 'utf8').trim();
    } catch {
      cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(file, cfg.sessionSecret, { mode: 0o600 });
    }
  }
  return cfg;
}
