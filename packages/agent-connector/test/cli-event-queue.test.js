'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { createCliEventQueue } = require('../src/adapters/cli-event-queue');

it('delivers an unconfirmed preview before the next chunk arrives', async () => {
  const seen = [];
  const queue = createCliEventQueue(async (event, next) => seen.push([event, next]));
  queue.write(Buffer.from('{"text":"working"}\n'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(seen, [[{ text: 'working' }, null]]);
  queue.write(Buffer.from('{"type":"error"}\n'));
  await queue.finish();
  assert.deepEqual(seen[1], [{ type: 'error' }, null]);
});

it('reads a split UTF-8 character and an unterminated final event', async () => {
  const seen = [];
  const queue = createCliEventQueue(async (event, next) => seen.push([event, next]));
  const bytes = Buffer.from('{"text":"好"}\n{"done":true}');
  const split = bytes.indexOf(Buffer.from('好')) + 1;
  queue.write(bytes.subarray(0, split));
  queue.write(bytes.subarray(split));
  await queue.finish();
  assert.deepEqual(seen, [[{ text: '好' }, { done: true }], [{ done: true }, null]]);
});
