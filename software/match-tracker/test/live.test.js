import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/tournament.js';
import { LiveFight } from '../src/live.js';

function setup() {
  const doc = T.newEvent();
  T.addRobot(doc, { name: 'Alpha' });
  T.addRobot(doc, { name: 'Beta' });
  T.generateRound(doc, () => 0.5);
  const sent = [];
  let t = 0;
  const live = new LiveFight({ store: { doc }, led: { send: c => sent.push(c) }, clock: () => t });
  return { doc, live, sent, fight: doc.fights[0], at: ms => { t = ms; live.tick(ms); } };
}

test('full fight: ready → countdown → running → time → judges decision', () => {
  const { doc, live, sent, fight, at } = setup();
  live.load(fight.id);
  assert.equal(sent.at(-1).label, 'ready');
  live.start();
  assert.equal(doc.live.phase, 'countdown');
  assert.equal(sent.at(-1).type, 'countdown');
  assert.equal(sent.at(-1).seconds, 3);
  at(2999); assert.equal(doc.live.phase, 'countdown');
  at(3000); assert.equal(doc.live.phase, 'running');
  at(3000 + 60_000); assert.equal(live.elapsed(), 60_000);
  at(3000 + 90_000); assert.equal(sent.at(-1).fx, 'blink', '30 s warning');
  assert.equal(sent.at(-1).target, 'ceiling');
  at(3000 + 120_000);
  assert.equal(doc.live.phase, 'time');
  assert.equal(sent.at(-1).label, 'time');
  live.end('blue', 'judges');
  assert.equal(fight.status, 'done');
  assert.equal(fight.winner, 'blue');
  assert.equal(fight.durationMs, 120_000);
  assert.equal(sent.at(-2).color, 'blue');
  assert.equal(T.standings(doc).find(r => r.id === fight.blue).wins, 1);
});

test('pause freezes the clock; resume counts down again', () => {
  const { doc, live, sent, fight, at } = setup();
  live.load(fight.id);
  live.start();
  at(3000);
  at(13_000);
  live.pause();
  assert.equal(sent.at(-1).label, 'pause');
  at(60_000);
  assert.equal(live.elapsed(), 10_000);
  live.start();
  assert.equal(doc.live.phase, 'countdown');
  at(63_000);
  at(68_000);
  assert.equal(live.elapsed(), 15_000);
});

test('stop is a red pause; scene() restores the right lights', () => {
  const { live, fight, at } = setup();
  assert.equal(live.scene()[0].label, 'idle');
  live.load(fight.id);
  live.start();
  at(3000);
  assert.equal(live.scene()[0].label, 'fight');
  live.pause(true);
  assert.equal(live.scene()[0].label, 'stop');
});

test('a count right after GO first settles the arena into the fight color', () => {
  const { live, sent, fight, at } = setup();
  live.led.fightColor = 'white';
  live.load(fight.id);
  live.start();
  at(3000);
  at(4000);                       // driver still flashing GO
  live.count('red');
  assert.deepEqual([sent.at(-2).type, sent.at(-2).color], ['solid', 'white']);
  assert.equal(sent.at(-1).type, 'countdown');
  assert.equal(live.scene()[0].color, 'white');
});

test('faults and counts target the robot side; counts expire', () => {
  const { doc, live, sent, fight, at } = setup();
  live.load(fight.id);
  assert.throws(() => live.count('red'), /during the fight/);
  live.start();
  at(3000);
  live.fault('red');
  assert.equal(fight.faults.red, 1);
  assert.deepEqual([sent.at(-1).target, sent.at(-1).overlay], ['red', true]);
  live.count('blue', 'ko');
  assert.deepEqual([sent.at(-1).type, sent.at(-1).target, sent.at(-1).seconds], ['countdown', 'blue', 10]);
  at(13_000);
  assert.equal(doc.live.count.expired, true);
  at(16_000);
  assert.equal(doc.live.count, null);
  live.count('red', 'pin');
  live.cancelCount();
  assert.deepEqual(sent.at(-1), { type: 'cancel', target: 'red' });
});

test('KO before time ends the fight with the elapsed duration', () => {
  const { live, fight, at } = setup();
  live.load(fight.id);
  live.start();
  at(3000);
  at(48_000);
  live.end('red', 'ko');
  assert.equal(fight.durationMs, 45_000);
  assert.equal(fight.method, 'ko');
  assert.throws(() => live.start(), /Cannot start/);
});

test('only one fight at a time; unload returns to idle', () => {
  const { doc, live, sent, fight } = setup();
  const other = T.addFight(doc, { red: fight.red, blue: fight.blue, ranked: false });
  live.load(fight.id);
  live.start();
  assert.throws(() => live.load(other.id), /in progress/);
  live.unload();
  assert.equal(doc.live, null);
  assert.equal(sent.at(-1).label, 'idle');
  assert.equal(fight.status, 'pending');
});
