// Robot registrations from the Google Form sheet (or any CSV export of it).
// Columns are found by their header text, so reordering the form is fine.
// PRIVACY: email, phone, timestamp and address columns are never read into the
// event — organizers keep those in the sheet.
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev) — Non-Commercial Source-Available License.
import { addRobot, updateRobot, clipBio } from './tournament.js';

const PRIVATE = /e-?mail|phone|timestamp|address|whatsapp|contact/i;
const COLUMNS = {
  name:     h => /robot'?s?\s*name/i.test(h) || /^robot$/i.test(h),
  builder:  h => /(your name|team|builder)/i.test(h) && !/robot\s*name/i.test(h),
  bio:      h => /(tell us|about your robot|describe|description|weapon)/i.test(h),
  rulesAck: h => /(rules|confirm)/i.test(h),
};

// RFC 4180: quoted fields, "" escapes, newlines inside quotes, CRLF.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim()));
}

// Which column holds what. Private columns are excluded before matching.
export function mapColumns(headers) {
  const map = {}, ignored = [];
  headers.forEach((raw, i) => {
    const h = raw.replace(/\s+/g, ' ').trim();
    if (PRIVATE.test(h)) { ignored.push(h); return; }
    const key = Object.keys(COLUMNS).find(k => map[k] === undefined && COLUMNS[k](h));
    if (key) map[key] = i; else ignored.push(h);
  });
  return { map, ignored };
}

// The CSV export URL for a Google Sheets link (keeps the tab via gid). Only
// docs.google.com is accepted — the server fetches it, so no arbitrary URLs.
export function googleCsvUrl(link) {
  let u;
  try { u = new URL(String(link).trim()); } catch { throw new Error('Not a valid URL'); }
  const m = /^\/spreadsheets\/d\/([\w-]{20,})/.exec(u.pathname);
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || !m) throw new Error('Use a docs.google.com/spreadsheets link');
  const gid = u.searchParams.get('gid') || /gid=(\d+)/.exec(u.hash)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

export async function fetchSheet(link, fetchImpl = fetch) {
  const res = await fetchImpl(googleCsvUrl(link), { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Google answered ${res.status} — is the sheet shared as "anyone with the link"?`);
  if (!/text\/csv/.test(res.headers.get('content-type') || '')) throw new Error('Google did not return CSV — check the sharing settings');
  const text = await res.text();
  if (text.length > 1_000_000) throw new Error('Sheet too large');
  return text;
}

// Add new robots and update existing ones (matched by name, case-insensitive).
// Never deletes or renames. Returns a summary for the referee.
export function importRobots(doc, csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('No registrations found (need a header row and at least one entry)');
  const { map, ignored } = mapColumns(rows[0]);
  if (map.name === undefined) throw new Error('No "Robot name" column found');
  const cell = (r, k) => (map[k] === undefined ? '' : (r[map[k]] || '').replace(/\s+/g, ' ').trim());
  const sum = { added: [], updated: [], unchanged: 0, skipped: [], ignoredColumns: ignored };
  for (const r of rows.slice(1)) {
    const name = cell(r, 'name');
    if (!name) { sum.skipped.push('(row without a robot name)'); continue; }
    // bio clipped like the server stores it, so an unchanged long answer is not "updated" on every re-import
    const fields = { builder: cell(r, 'builder'), bio: clipBio(cell(r, 'bio')), rulesAck: cell(r, 'rulesAck') };
    const existing = doc.robots.find(x => x.name.toLowerCase() === name.toLowerCase());
    try {
      if (!existing) {
        addRobot(doc, { name, ...fields });
        sum.added.push(name);
      } else {
        const changes = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v && v !== (existing[k] || '')));
        if (Object.keys(changes).length) { updateRobot(doc, { id: existing.id, ...changes }); sum.updated.push(name); }
        else sum.unchanged++;
      }
    } catch (e) {
      sum.skipped.push(`${name}: ${e.message}`);
    }
  }
  return sum;
}
