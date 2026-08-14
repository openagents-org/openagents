'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ConsumptionStore, DONE_HISTORY } = require('../src/adapters/consumption-store');

function tmpStore(name = 'agent-a') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-consumption-'));
  return new ConsumptionStore('ws-1', name, { dir });
}

test('a fresh store has no cursor, so the caller skips to the head', () => {
  assert.strictEqual(tmpStore().cursor(), null);
});

test('the cursor survives a restart', () => {
  const store = tmpStore();
  store.resetCursor('evt-1');
  store.advanceCursor('evt-9');

  const reopened = new ConsumptionStore('ws-1', 'agent-a', { dir: store.dir });
  assert.strictEqual(reopened.cursor(), 'evt-9');
});

test('the cursor does not advance while work is in flight', () => {
  // The safety property: a crash must re-fetch unfinished work rather than
  // step over it.
  const store = tmpStore();
  store.resetCursor('evt-1');
  store.claim('msg-1');

  assert.strictEqual(store.advanceCursor('evt-5'), false);
  assert.strictEqual(store.cursor(), 'evt-1');

  store.markDone('msg-1');
  assert.strictEqual(store.advanceCursor('evt-5'), true);
  assert.strictEqual(store.cursor(), 'evt-5');
});

test('a message cannot be claimed twice', () => {
  const store = tmpStore();
  assert.strictEqual(store.claim('msg-1'), true);
  assert.strictEqual(store.claim('msg-1'), false);
});

test('a finished message is not handled again after a restart', () => {
  const store = tmpStore();
  store.claim('msg-1');
  store.markDone('msg-1');

  const reopened = new ConsumptionStore('ws-1', 'agent-a', { dir: store.dir });
  assert.strictEqual(reopened.isSettled('msg-1'), true);
  assert.strictEqual(reopened.claim('msg-1'), false);
});

test('a message claimed but never finished is reported as abandoned', () => {
  const store = tmpStore();
  store.resetCursor('evt-1');
  store.claim('msg-1');
  store.claim('msg-2');
  store.markDone('msg-1');

  // Process dies here.
  const reopened = new ConsumptionStore('ws-1', 'agent-a', { dir: store.dir });
  assert.deepStrictEqual(reopened.pending(), ['msg-2']);
});

test('releasing an abandoned claim lets the cursor move again', () => {
  const store = tmpStore();
  store.resetCursor('evt-1');
  store.claim('msg-1');

  const reopened = new ConsumptionStore('ws-1', 'agent-a', { dir: store.dir });
  for (const id of reopened.pending()) reopened.release(id);

  assert.strictEqual(reopened.hasInflight(), false);
  assert.strictEqual(reopened.claim('msg-1'), true, 'the message is replayable');
});

test('two agents in one workspace keep separate state', () => {
  const a = tmpStore('agent-a');
  const b = new ConsumptionStore('ws-1', 'agent-b', { dir: a.dir });
  a.claim('msg-1');
  assert.strictEqual(b.isSettled('msg-1'), false);
});

test('the done list is bounded', () => {
  const store = tmpStore();
  for (let i = 0; i < DONE_HISTORY + 50; i++) store.markDone(`msg-${i}`);
  assert.ok(store.load().done.length <= DONE_HISTORY);
});

test('a corrupted state file reads as a first run rather than throwing', () => {
  // Half-written JSON is what a machine losing power leaves behind. Starting
  // over is survivable; refusing to start is not.
  const store = tmpStore();
  store.resetCursor('evt-1');
  fs.writeFileSync(store.file, '{"cursor": "evt-1", "inflig');

  const reopened = new ConsumptionStore('ws-1', 'agent-a', { dir: store.dir });
  assert.strictEqual(reopened.cursor(), null);
});

test('an unwritable directory degrades instead of crashing the agent', () => {
  // Losing persistence drops that message back to the old in-memory
  // behaviour. Taking the agent down with it would be strictly worse.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-consumption-'));
  const blocker = path.join(tmp, 'blocker');
  fs.writeFileSync(blocker, 'not a directory');

  const store = new ConsumptionStore('ws-1', 'agent-a', { dir: path.join(blocker, 'state') });
  assert.doesNotThrow(() => {
    store.resetCursor('evt-1');
    store.claim('msg-1');
    store.markDone('msg-1');
  });
});
