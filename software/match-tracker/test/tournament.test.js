import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/tournament.js';

// Deterministic RNG for repeatable draws.
const rng = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function event(n) {
  const doc = T.newEvent();
  for (let i = 1; i <= n; i++) T.addRobot(doc, { name: `Bot ${i}` });
  return doc;
}

// Finish every pending fight in the latest round; the lower robot id wins.
function playRound(doc, now = 1000) {
  for (const f of doc.fights.filter(f => f.status === 'pending')) {
    const winner = Number(f.red.slice(1)) < Number(f.blue.slice(1)) ? 'red' : 'blue';
    T.setResult(doc, { id: f.id, winner, method: 'judges' }, now);
  }
}

test('robots: names are required, unique and trimmed', () => {
  const doc = T.newEvent();
  assert.equal(T.addRobot(doc, { name: '  Spinny   McSpin ' }).name, 'Spinny McSpin');
  assert.throws(() => T.addRobot(doc, { name: 'spinny mcspin' }), /already exists/);
  assert.throws(() => T.addRobot(doc, { name: '   ' }), /required/);
});

test('round 1 pairs everyone once; odd count gives exactly one bye', () => {
  const doc = event(7);
  T.generateRound(doc, rng());
  const fights = doc.fights.filter(f => f.round === 1);
  assert.equal(fights.length, 4);
  const byes = fights.filter(f => f.method === 'bye');
  assert.equal(byes.length, 1);
  assert.equal(byes[0].status, 'done');
  const seen = fights.flatMap(f => [f.red, f.blue]).filter(Boolean);
  assert.equal(new Set(seen).size, 7);
});

test('cannot generate the next round before the current one is finished', () => {
  const doc = event(4);
  T.generateRound(doc, rng());
  assert.throws(() => T.generateRound(doc, rng()), /Finish round 1/);
});

test('swiss: no rematches across 4 rounds of 8, records pair together', () => {
  const doc = event(8);
  for (let r = 1; r <= 4; r++) {
    T.generateRound(doc, rng(r));
    if (r > 1) {
      // Each pairing joins robots whose wins differ by at most 1.
      const wins = new Map(T.standings(doc).map(s => [s.id, s.wins]));
      for (const f of doc.fights.filter(f => f.round === r)) assert.ok(Math.abs(wins.get(f.red) - wins.get(f.blue)) <= 1);
    }
    playRound(doc);
  }
  const pairs = doc.fights.map(f => [f.red, f.blue].sort().join('-'));
  assert.equal(new Set(pairs).size, pairs.length, 'no repeated pairing');
  const top = T.standings(doc)[0];
  assert.equal(top.wins, 4);
  assert.equal(top.rank, 1);
});

test('byes rotate: nobody gets a second bye while others have none', () => {
  const doc = event(5);
  doc.event.rounds = 5;
  for (let r = 1; r <= 5; r++) { T.generateRound(doc, rng(r)); playRound(doc); }
  const byes = T.standings(doc).map(s => s.byes);
  assert.deepEqual(byes.sort(), [1, 1, 1, 1, 1]);
});

test('dropped robots are not paired', () => {
  const doc = event(4);
  T.updateRobot(doc, { id: 'r4', dropped: true });
  T.generateRound(doc, rng());
  assert.ok(!doc.fights.some(f => f.red === 'r4' || f.blue === 'r4'));
  assert.equal(doc.fights.filter(f => f.method === 'bye').length, 1);
});

test('standings: wins, then Buchholz; exhibition fights never count', () => {
  const doc = event(4);
  T.generateRound(doc, rng());
  playRound(doc);
  const ex = T.addFight(doc, { red: 'r3', blue: 'r4', ranked: false });
  T.setResult(doc, { id: ex.id, winner: 'red', method: 'ko' });
  const st = T.standings(doc);
  assert.equal(st.reduce((s, r) => s + r.wins, 0), 2, 'only the 2 ranked fights count');
  assert.ok(st[0].wins >= st[st.length - 1].wins);
});

test('edits: swap corners, reorder, reset, delete round', () => {
  const doc = event(4);
  T.generateRound(doc, rng());
  const [a, b] = doc.fights;
  const [red, blue] = [a.red, a.blue];
  T.swapCorners(doc, a.id);
  assert.deepEqual([a.red, a.blue], [blue, red]);
  T.moveFight(doc, b.id, -1);
  assert.ok(b.seq < a.seq);
  T.setResult(doc, { id: a.id, winner: 'red', method: 'ko' });
  assert.throws(() => T.deleteRound(doc, 1), /has results/);
  T.resetResult(doc, a.id);
  assert.equal(a.status, 'pending');
  T.deleteRound(doc, 1);
  assert.equal(doc.fights.length, 0);
  assert.equal(doc.rounds.length, 0);
});

test('robots with fights cannot be removed, only dropped', () => {
  const doc = event(2);
  T.generateRound(doc, rng());
  assert.throws(() => T.removeRobot(doc, 'r1'), /drop it/);
});

test('queue reports rest time since each robot last fought', () => {
  const doc = event(4);
  doc.event.rounds = 2;
  T.generateRound(doc, rng());
  playRound(doc, 10_000);
  T.generateRound(doc, rng(2));
  const q = T.queue(doc, 70_000);
  assert.equal(q.length, 2);
  assert.ok(q.every(x => x.restRed === 60_000 && x.restBlue === 60_000));
});

test('fight history: change a result in place, reset one robot\'s results', () => {
  const doc = event(4);
  doc.event.rounds = 2;
  T.generateRound(doc, rng());
  playRound(doc, 10_000);
  const f = doc.fights.find(x => x.round === 1);
  const loser = f.winner === 'red' ? f.blue : f.red;
  const row = id => T.standings(doc).find(s => s.id === id);
  assert.equal(row(loser).wins, 0);
  T.setResult(doc, { id: f.id, winner: f.winner === 'red' ? 'blue' : 'red', method: 'judges' });   // corrected
  assert.equal(row(loser).wins, 1);
  assert.equal(f.method, 'judges');
  T.generateRound(doc, rng(2));
  playRound(doc, 20_000);
  assert.equal(T.resetRobotResults(doc, loser), 2);
  assert.ok(doc.fights.filter(x => x.red === loser || x.blue === loser).every(x => x.status === 'pending'));
  assert.equal(row(loser).played, 0);
  assert.equal(T.resetRobotResults(doc, loser), 0);
  doc.live = { fightId: f.id };
  T.setResult(doc, { id: f.id, winner: 'red', method: 'ko' });
  assert.throws(() => T.resetRobotResults(doc, f.red), /loaded/);
});

test('reset all results keeps pairings and byes', () => {
  const doc = event(5);
  doc.event.rounds = 2;
  T.generateRound(doc, rng());
  playRound(doc);
  const fights = doc.fights.length;
  assert.equal(T.resetAllResults(doc), 2);
  assert.equal(doc.fights.length, fights);
  assert.equal(doc.fights.filter(f => f.status === 'done').length, 1, 'the bye stays');
  assert.ok(T.standings(doc).every(s => s.played === 0));
});
