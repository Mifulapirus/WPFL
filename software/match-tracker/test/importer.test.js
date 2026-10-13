import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/tournament.js';
import { parseCsv, mapColumns, importRobots, googleCsvUrl } from '../src/importer.js';

// Same headers as the WPFL registration form (fake rows).
const HEAD = 'Timestamp,Email Address,Your name or Team\'s name,Phone number (Just in case we need to find you during the event),' +
  'Robot name,"Tell us about your robot, it deserves to be known!\nWhat\'s cool about it? What is the weapon like?",' +
  '"Please confirm you have read the rules. We\'ll confirm the basics below."';
const row = (name, team, bio) => `10/1/2026 10:00:00,someone@example.com,${team},5125550100,${name},"${bio}","My robot is less than 1Kg, My weapon design follows the WPFL rules"`;
const CSV = [HEAD, row('Spinny', 'Team Rocket', 'A ""vertical"" spinner.\nVery loud.'), row('Wedgie', 'Sam', 'Low and fast'), ',,,,,,'].join('\r\n');

test('parseCsv handles quotes, escaped quotes, embedded newlines and CRLF', () => {
  const rows = parseCsv(CSV);
  assert.equal(rows.length, 3, 'blank row dropped');
  assert.equal(rows[0].length, 7);
  assert.equal(rows[1][5], 'A "vertical" spinner.\nVery loud.');
});

test('private columns are never mapped', () => {
  const { map, ignored } = mapColumns(parseCsv(CSV)[0]);
  assert.deepEqual(Object.keys(map).sort(), ['bio', 'builder', 'name', 'rulesAck']);
  assert.equal(map.name, 4);
  assert.ok(ignored.some(h => /Email/.test(h)) && ignored.some(h => /Phone/.test(h)) && ignored.includes('Timestamp'));
});

test('import adds robots without any private data, then updates by name', () => {
  const doc = T.newEvent();
  const s1 = importRobots(doc, CSV);
  assert.deepEqual(s1.added, ['Spinny', 'Wedgie']);
  const json = JSON.stringify(doc);
  assert.ok(!json.includes('example.com') && !json.includes('5125550100') && !json.includes('10/1/2026'), 'no email/phone/timestamp stored');
  const sp = doc.robots[0];
  assert.equal(sp.builder, 'Team Rocket');
  assert.equal(sp.bio, 'A "vertical" spinner. Very loud.');
  assert.match(sp.rulesAck, /less than 1Kg/);

  T.updateRobot(doc, { id: sp.id, notes: 'battery checked' });
  const s2 = importRobots(doc, CSV.replace('Low and fast', 'Low, fast, mean'));
  assert.deepEqual(s2.added, []);
  assert.deepEqual(s2.updated, ['Wedgie']);
  assert.equal(s2.unchanged, 1);
  assert.equal(doc.robots.length, 2);
  assert.equal(sp.notes, 'battery checked', 'referee notes survive a re-import');
});

test('public robots expose only the allow-listed fields', () => {
  const doc = T.newEvent();
  importRobots(doc, CSV);
  T.updateRobot(doc, { id: doc.robots[0].id, notes: 'private' });
  assert.deepEqual(Object.keys(T.publicRobot(doc.robots[0])).sort(), ['bio', 'builder', 'dropped', 'hideCard', 'id', 'name', 'photo', 'photo2', 'team', 'teamBio']);
});

test('a CSV without a robot-name column is rejected', () => {
  assert.throws(() => importRobots(T.newEvent(), 'Email,Phone\na@b.c,1'), /Robot name/);
});

test('only docs.google.com sheet links are fetched', () => {
  assert.equal(googleCsvUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab/edit?usp=sharing'),
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab/export?format=csv');
  assert.match(googleCsvUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab/edit#gid=42'), /&gid=42$/);
  assert.throws(() => googleCsvUrl('https://evil.example/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab'), /docs.google.com/);
  assert.throws(() => googleCsvUrl('http://169.254.169.254/latest'), /docs.google.com/);
});

test('a hidden card sends neither its texts nor its pictures (front and back)', () => {
  const doc = T.newEvent();
  const r = T.addRobot(doc, { name: 'Ghost', bio: 'secret plans', teamBio: 'secret team' });
  r.photo = 'aaaaaaaaaaaaaaaaaaaaaaaa.webp';
  r.photo2 = 'bbbbbbbbbbbbbbbbbbbbbbbb.webp';
  assert.equal(T.publicRobot(r).teamBio, 'secret team');
  T.updateRobot(doc, { id: r.id, hideCard: true });
  const pub = T.publicRobot(r);
  assert.deepEqual([pub.name, pub.bio, pub.photo, pub.teamBio, pub.photo2, pub.hideCard], ['Ghost', '', '', '', '', true]);
});

test('battlecard text is limited to 220 characters, cut at a word', () => {
  const long = 'This robot is a pacifist who loves peace so much, it is willing to destroy for it. '.repeat(4);
  const clipped = T.clipBio(long);
  assert.ok(clipped.length <= T.BIO_MAX && clipped.endsWith('…'));
  assert.ok(!/\s…$/.test(clipped) && long.startsWith(clipped.slice(0, -1)));
  assert.equal(T.clipBio('short and sweet'), 'short and sweet');
  const doc = T.newEvent();
  importRobots(doc, `Robot name,Tell us about your robot\nSpinny,"${long}"`);
  const again = importRobots(doc, `Robot name,Tell us about your robot\nSpinny,"${long}"`);
  assert.equal(again.unchanged, 1, 'a long answer is not re-imported as a change');
});
