import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '../src/tournament.js';
import { Store } from '../src/store.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wpfl-store-'));
const tmpStore = () => new Store(tmpDir());

function playedEvent(name) {
  const doc = T.newEvent();
  doc.event.name = name;
  doc.event.rounds = 1;
  T.addRobot(doc, { name: 'Alpha' });
  T.addRobot(doc, { name: 'Beta' });
  T.generateRound(doc, () => 0.5);
  T.setResult(doc, { id: doc.fights[0].id, winner: 'red', method: 'ko' });
  return doc;
}

test('archive: saves, lists newest first with the champion, reads back', () => {
  const s = tmpStore();
  assert.equal(s.archive(T.newEvent()), null, 'empty events are not archived');
  const a = s.archive(playedEvent('Spring Brawl'), new Date('2026-04-01T18:00:00Z'));
  const b = s.archive(playedEvent('Spring Brawl'), new Date('2026-10-24T20:30:00Z'));
  assert.match(a, /^20260401-180000-spring-brawl$/);
  assert.deepEqual(s.archives.map(x => x.id), [b, a]);
  const sum = s.archives[0];
  assert.equal(sum.finished, true);
  assert.ok(['Alpha', 'Beta'].includes(sum.champion));
  assert.equal(s.readArchive(a).robots.length, 2);
});

test('archive ids are validated (no path traversal)', () => {
  const s = tmpStore();
  assert.equal(s.readArchive('../event'), null);
  assert.equal(s.readArchive('20260101-000000-../../x'), null);
});

test('deleting a past event moves it to trash: gone from lists and reads', () => {
  const s = tmpStore();
  const id = s.archive(playedEvent('Oops Event'));
  s.deleteArchive(id);
  assert.equal(s.archives.length, 0);
  assert.equal(s.readArchive(id), null);
  assert.ok(fs.existsSync(path.join(s.archiveDir, 'trash', id + '.json')), 'still recoverable on disk');
  assert.equal(new Store(s.dir).archives.length, 0, 'stays deleted after a restart');
  assert.throws(() => s.deleteArchive(id), /Unknown/);
  assert.throws(() => s.deleteArchive('../event'), /Unknown/);
});

test('events: created, persisted, reloaded; only one live', () => {
  const dir = tmpDir();
  const s = new Store(dir);
  const a = s.add(T.newEvent());
  const b = s.add(playedEvent('Fall Fights'));
  a.status = 'live'; b.status = 'live';
  s.write(a.id); s.write(b.id);
  const again = new Store(dir);
  assert.equal(again.events.size, 2);
  assert.equal(again.list().filter(d => d.status === 'live').length, 1, 'a second live event is demoted');
  assert.equal(again.get(b.id).robots.length, 2);
});

test('lifecycle: a live event ends as a past event; a past event restores as a draft', () => {
  const s = tmpStore();
  const d = s.add(playedEvent('Halloween Havoc'));
  d.status = 'live';
  const archived = s.archiveEvent(d.id);
  assert.equal(s.get(d.id), null);
  assert.equal(s.archives[0].id, archived);
  assert.equal(s.archives[0].published, true);
  const back = s.restoreArchive(archived);
  assert.equal(back.status, 'draft');
  assert.equal(back.live, null);
  assert.equal(back.fights.filter(f => f.status === 'done').length, 1, 'results come back');
  s.removeEvent(back.id);
  assert.ok(fs.existsSync(path.join(s.eventsDir, 'trash', `${back.id}.json`)), 'deleted events go to trash');
});

test('migrates v1 data: current event + upcoming list become events', () => {
  const dir = tmpDir();
  const legacy = T.newEvent();
  delete legacy.status; legacy.published = false;
  T.addRobot(legacy, { name: 'Spinny' });
  fs.writeFileSync(path.join(dir, 'event.json'), JSON.stringify(legacy));
  fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify({ upcoming: [
    { id: 'u2', name: 'WPFL @ ASMBLY', date: '2026-10-24', time: '', location: 'Asmbly', link: 'https://x.y', note: '', image: 'aaaaaaaaaaaaaaaaaaaaaaaa.webp' },
    { id: 'u3', name: 'Spring', date: '2027-03-13', time: '4 PM', location: '', link: '', note: 'bring snacks' },
  ] }));
  const s = new Store(dir);
  const byName = Object.fromEntries(s.list().map(d => [d.event.name, d]));
  assert.equal(byName['New event'].status, 'draft');
  assert.equal(byName['New event'].robots.length, 1);
  assert.equal(byName['WPFL @ ASMBLY'].status, 'published');
  assert.equal(byName['WPFL @ ASMBLY'].event.image, 'aaaaaaaaaaaaaaaaaaaaaaaa.webp');
  assert.equal(byName['WPFL @ ASMBLY'].event.date, '2026-10-24');
  assert.equal(byName.Spring.event.note, '4 PM · bring snacks', 'free-text time is kept in the note');
  assert.ok(fs.existsSync(path.join(dir, 'event.json.migrated')) && fs.existsSync(path.join(dir, 'site.json.migrated')));
  assert.equal(new Store(dir).events.size, 3, 'migration runs once');
});

test('media in use: events, past events and trash all count', () => {
  const s = tmpStore();
  const doc = playedEvent('Photo Day');
  doc.robots[0].photo = '0123456789abcdef01234567.webp';
  const d = s.add(doc);
  assert.equal(s.mediaInUse('0123456789abcdef01234567.webp'), true);
  d.status = 'live';
  const id = s.archiveEvent(d.id);
  assert.equal(s.mediaInUse('0123456789abcdef01234567.webp'), true, 'past event');
  s.deleteArchive(id);
  assert.equal(s.mediaInUse('0123456789abcdef01234567.webp'), true, 'trash still counts (recoverable)');
  assert.equal(s.mediaInUse('ffffffffffffffffffffffff.webp'), false);
});

test('copying robots between events skips names already there', () => {
  const a = T.newEvent(), b = T.newEvent();
  T.addRobot(a, { name: 'Alpha', bio: 'fast', notes: 'battery ok' });
  T.addRobot(a, { name: 'Beta' });
  T.addRobot(b, { name: 'beta' });
  const r = T.copyRobots(b, a);
  assert.deepEqual(r, { added: ['Alpha'], skipped: ['Beta'] });
  assert.equal(b.robots.find(x => x.name === 'Alpha').bio, 'fast');
});
