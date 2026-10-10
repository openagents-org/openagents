'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BaseAdapter = require('../src/adapters/base');
const {
  FailureStreak,
  isTransientNetworkError,
  isLogPoint,
  formatDuration,
} = require('../src/adapters/failure-streak');

describe('FailureStreak', () => {
  it('logs the 1st, 3rd, 10th, 30th and every 100th failure', () => {
    const logged = [];
    for (let n = 1; n <= 250; n++) if (isLogPoint(n)) logged.push(n);
    assert.deepEqual(logged, [1, 3, 10, 30, 100, 200]);
  });

  it('reports the streak a success ends', () => {
    const s = new FailureStreak();
    assert.equal(s.succeed(1000), null);
    assert.equal(s.fail(1000), true);
    assert.equal(s.fail(2000), false);
    assert.deepEqual(s.succeed(61_000), { count: 2, ms: 60_000 });
    assert.equal(s.count, 0);
    assert.equal(s.succeed(70_000), null);
  });

  it('formats durations', () => {
    assert.equal(formatDuration(45_000), '45s');
    assert.equal(formatDuration(12 * 60_000), '12m');
    assert.equal(formatDuration(3 * 3_600_000), '3h');
  });
});

describe('isTransientNetworkError', () => {
  const err = (message, extra = {}) => Object.assign(new Error(message), extra);

  it('treats timeouts, dropped connections and overloaded servers as transient', () => {
    assert.equal(isTransientNetworkError(err('Request timed out after 15s', { code: 'ETIMEDOUT' })), true);
    assert.equal(isTransientNetworkError(err('The operation was aborted', { name: 'AbortError' })), true);
    assert.equal(isTransientNetworkError(err('read ECONNRESET', { code: 'ECONNRESET' })), true);
    assert.equal(isTransientNetworkError(err('getaddrinfo ENOTFOUND x', { code: 'ENOTFOUND' })), true);
    assert.equal(isTransientNetworkError(err('socket hang up')), true);
    assert.equal(isTransientNetworkError(err('Service Unavailable', { status: 503 })), true);
    assert.equal(isTransientNetworkError(err('Too Many Requests', { status: 429 })), true);
  });

  it('does not excuse rejections and bugs', () => {
    assert.equal(isTransientNetworkError(err('Invalid workspace credentials', { status: 401 })), false);
    assert.equal(isTransientNetworkError(err('Not found', { status: 404 })), false);
    assert.equal(isTransientNetworkError(err("Cannot read properties of undefined (reading 'id')")), false);
    assert.equal(isTransientNetworkError(null), false);
  });
});

class StubAdapter extends BaseAdapter {
  constructor() {
    super({ workspaceId: 'ws-1', channelName: 'general', token: 't', agentName: 'stub' });
    this.logs = [];
    this._log = (msg, level = 'info') => this.logs.push({ level, msg });
  }
  async _handleMessage() {}
}

/** Poll with `outcomes` (an Error to throw, or anything else to succeed), then stop. */
async function runPolls(adapter, outcomes) {
  let i = 0;
  adapter.client = {
    pollPending: async () => {
      const outcome = outcomes[i++];
      if (i >= outcomes.length) adapter._running = false;
      if (outcome instanceof Error) throw outcome;
      return { messages: [], cursor: null };
    },
  };
  adapter._running = true;
  adapter._sleep = async () => {};
  await adapter._pollLoop();
}

describe('BaseAdapter poll loop — failure logging', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-pollfail-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const make = () => {
    const a = new StubAdapter();
    a._cursorFile = path.join(tmp, 'cursor.json');
    return a;
  };
  const timeout = () => Object.assign(new Error('Request timed out after 15s'), { code: 'ETIMEDOUT' });

  it('logs a network outage as a few WARN lines without a stack, then its recovery', async () => {
    const a = make();
    await runPolls(a, [...Array.from({ length: 12 }, timeout), 'ok']);
    const failures = a.logs.filter((l) => /failed/.test(l.msg));
    assert.deepEqual(failures.map((l) => l.level), ['warn', 'warn', 'warn']);
    assert.match(failures[0].msg, /^Poll #1 failed: Request timed out after 15s — retrying every 5s$/);
    assert.match(failures[1].msg, /^Poll #3 failed: .*\(consecutive failures: 3\)/);
    assert.match(failures[2].msg, /^Poll #10 failed: .*\(consecutive failures: 10\)/);
    assert.ok(failures.every((l) => !/Stack:/.test(l.msg)));
    const recovered = a.logs.find((l) => /recovered/.test(l.msg));
    assert.equal(recovered.level, 'info');
    assert.match(recovered.msg, /^Poll recovered after 12 unsuccessful attempt\(s\) over \d+s$/);
  });

  it('logs an unexpected failure as ERROR, with its stack the first time only', async () => {
    const a = make();
    const bug = () => new TypeError("Cannot read properties of undefined (reading 'id')");
    await runPolls(a, [bug(), bug(), bug()]);
    const failures = a.logs.filter((l) => /failed/.test(l.msg));
    assert.deepEqual(failures.map((l) => l.level), ['error', 'error']);
    assert.match(failures[0].msg, /\nStack: TypeError/);
    assert.doesNotMatch(failures[1].msg, /Stack:/);
  });
});
