'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { LogWriter, messageShape } = require('../src/log-writer');

const LINE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z (INFO|WARN|ERROR|DEBUG) /;

async function waitFor(cond, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('LogWriter', () => {
  let dir;
  let file;
  const writers = [];
  const make = (opts) => {
    const w = new LogWriter(file, opts);
    writers.push(w);
    return w;
  };
  const read = () => fs.readFileSync(file, 'utf-8');
  const lines = () => read().split('\n').filter(Boolean);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-logwriter-'));
    file = path.join(dir, 'daemon.log');
  });
  afterEach(async () => {
    for (const w of writers.splice(0)) {
      await waitFor(() => !w._rotating);
      w.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes the existing line format, with the level it is given', async () => {
    const w = make();
    w.write('info', 'daemon', 'Daemon started');
    w.write('warn', 'adapter [alpha]', 'Poll #1 failed: Request timed out after 15s');
    w.write('nonsense', 'launcher', 'unknown levels fall back to INFO');
    await w.flush();
    const got = lines();
    assert.equal(got.length, 3);
    for (const l of got) assert.match(l, LINE_RE);
    assert.match(got[0], / INFO daemon: Daemon started$/);
    assert.match(got[1], / WARN adapter \[alpha\]: Poll #1 failed/);
    assert.match(got[2], / INFO launcher: unknown levels/);
  });

  it('batches: nothing is written synchronously, one flush writes it all', async () => {
    const w = make({ flushMs: 10_000, rateBurst: 1000 });
    for (let i = 0; i < 50; i++) w.write('info', 'daemon', `line ${i}`);
    assert.equal(fs.existsSync(file), false);
    await w.flush();
    assert.equal(lines().length, 50);
  });

  it('flushSync writes what is queued, for process exit', () => {
    const w = make({ flushMs: 10_000 });
    w.write('info', 'daemon', 'last words');
    w.flushSync();
    assert.match(read(), /last words/);
  });

  it('suppresses repeats of the same shape and reports how many', async () => {
    const w = make({ rateBurst: 3 });
    for (let i = 1; i <= 10; i++) w.write('warn', 'adapter [alpha]', `Poll #${i} failed: timed out`);
    w.write('info', 'adapter [alpha]', 'something else');
    await w.flush();
    const got = lines();
    assert.equal(got.filter((l) => /Poll #\d+ failed/.test(l) && !/Suppressed/.test(l)).length, 3);
    const summary = got.find((l) => /Suppressed/.test(l));
    assert.ok(summary, 'a summary line is written when the window closes');
    assert.match(summary, / WARN adapter \[alpha\]: Suppressed 7 more like this in the last \d+s: Poll #1 failed: timed out$/);
    assert.ok(got.some((l) => /something else/.test(l)));
    assert.equal(w.stats.suppressed, 7);
  });

  it('never suppresses ERROR lines', async () => {
    const w = make({ rateBurst: 1 });
    for (let i = 0; i < 5; i++) w.write('error', 'daemon', `crashed ${i}`);
    await w.flush();
    assert.equal(lines().length, 5);
  });

  it('starts a fresh allowance once the window has passed', async () => {
    const w = make({ rateBurst: 1, rateWindowMs: 30 });
    w.write('info', 'daemon', 'tick 1');
    w.write('info', 'daemon', 'tick 2');
    await new Promise((r) => setTimeout(r, 50));
    w.write('info', 'daemon', 'tick 3');
    await w.flush();
    const got = lines();
    assert.ok(got.some((l) => /tick 3$/.test(l)));
    assert.ok(got.some((l) => /Suppressed 1 more like this/.test(l)));
  });

  it('drops the oldest waiting lines past the backlog bound, and says so', async () => {
    const w = make({ maxPendingBytes: 2000, flushMs: 10_000, rateBurst: 1000 });
    w._writing = true; // a write that never finishes: the disk is stuck
    for (let i = 0; i < 100; i++) w.write('info', 'daemon', `queued ${i} ${'x'.repeat(40)}`);
    assert.ok(w.stats.dropped > 0);
    w._writing = false;
    await w.flush();
    const got = lines();
    assert.match(got[0], / WARN daemon: Log writer fell behind — dropped \d+ line\(s\)$/);
    assert.match(got[got.length - 1], /queued 99 /);
  });

  it('rotates by copy-truncate into gzip generations, keeping `keep` of them', async () => {
    fs.writeFileSync(`${file}.1`, 'backup from the previous writer\n');
    const w = make({ maxBytes: 2000, keep: 2, rateBurst: 10_000 });
    const gen = (n) => `${file}.${n}.gz`;

    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 40; i++) w.write('info', 'daemon', `round ${round} line ${i} ${'y'.repeat(30)}`);
      await w.flush();
      await waitFor(() => !w._rotating && fs.existsSync(gen(1)));
    }

    assert.equal(w.stats.rotations, 3);
    assert.ok(fs.statSync(file).size < 2000);
    assert.equal(fs.existsSync(`${file}.1`), false, 'the old uncompressed backup is retired');
    assert.equal(fs.existsSync(gen(3)), false, 'only `keep` generations are kept');
    const newest = zlib.gunzipSync(fs.readFileSync(gen(1))).toString('utf-8');
    const older = zlib.gunzipSync(fs.readFileSync(gen(2))).toString('utf-8');
    assert.match(newest, /round 2 line 0 /);
    assert.match(older, /round 1 line 0 /);
  });

  it('keeps an inherited append handle writing into daemon.log after rotating', async () => {
    // The daemon's stdout/stderr are append-mode handles to daemon.log; a
    // rename-based rotation left them writing into the backup.
    const inherited = fs.openSync(file, 'a');
    try {
      const w = make({ maxBytes: 1000, rateBurst: 10_000 });
      for (let i = 0; i < 40; i++) w.write('info', 'daemon', `filler ${i} ${'z'.repeat(30)}`);
      await w.flush();
      await waitFor(() => !w._rotating && fs.existsSync(`${file}.1.gz`));
      fs.writeSync(inherited, 'written by a child after rotation\n');
      assert.match(read(), /written by a child after rotation/);
      assert.ok(fs.statSync(file).size < 1000);
    } finally {
      fs.closeSync(inherited);
    }
  });
});

describe('messageShape', () => {
  it('masks numbers and ids so repeats share a shape', () => {
    assert.equal(
      messageShape('Poll #257 failed: cursor=81f93179-0e15-4691-9680-85aad12afc61'),
      messageShape('Poll #258 failed: cursor=11111111-2222-3333-4444-555555555555'),
    );
    assert.notEqual(messageShape('Poll #1 failed'), messageShape('Heartbeat #1 failed'));
  });

  it('uses the first line only', () => {
    assert.equal(messageShape('boom\nStack: at a'), messageShape('boom\nStack: at b'));
  });
});
