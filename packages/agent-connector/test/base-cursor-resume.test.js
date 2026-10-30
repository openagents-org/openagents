/**
 * Poll-cursor persistence: a restarted adapter resumes where it left off
 * instead of jumping to the head of the stream (which silently dropped every
 * message that arrived while it was down). Replay is bounded by age.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BaseAdapter = require('../src/adapters/base');
const { STALE_MESSAGE_MAX_AGE_MS, CURSOR_RESUME_MAX_AGE_MS } = BaseAdapter;

class StubAdapter extends BaseAdapter {
  constructor(opts) {
    super({ workspaceId: 'ws-1', channelName: 'general', token: 't', agentName: 'stub', ...opts });
    this._log = () => {};
    this.handled = [];
    this.statuses = [];
  }
  async _handleMessage(msg) { this.handled.push(msg); }
  async sendStatus(channel, text) { this.statuses.push({ channel, text }); }
}

function makeAdapter(tmp, opts = {}) {
  const a = new StubAdapter(opts);
  a._cursorFile = path.join(tmp, 'cursor.json');
  a.client = {
    getHeadEventId: async () => 'head-1',
    pollPending: async () => ({ messages: [], cursor: null }),
  };
  return a;
}

/** Run exactly one iteration of the poll loop. */
async function pollOnce(adapter) {
  adapter._running = true;
  adapter._sleep = async () => { adapter._running = false; };
  await adapter._pollLoop();
}

function msg(id, ageMs, extra = {}) {
  return {
    messageId: id, sessionId: 'general', senderType: 'human', senderName: 'user',
    content: `m-${id}`, messageType: 'chat', metadata: {},
    createdAt: new Date(Date.now() - ageMs).toISOString(), ...extra,
  };
}

describe('BaseAdapter — poll cursor persistence & resume', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-cursor-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('first run: jumps to head and persists it', async () => {
    const a = makeAdapter(tmp);
    await a._skipExistingEvents();
    assert.equal(a._lastEventId, 'head-1');
    assert.equal(a._resumedFromCursor, false);
    const saved = JSON.parse(fs.readFileSync(a._cursorFile, 'utf-8'));
    assert.equal(saved.cursor, 'head-1');
    assert.equal(saved.workspaceId, 'ws-1');
    assert.equal(saved.agentName, 'stub');
  });

  it('persists the cursor returned by each poll (only when it changes)', async () => {
    const a = makeAdapter(tmp);
    let cursor = 'c-1';
    a.client.pollPending = async () => ({ messages: [], cursor });
    await pollOnce(a);
    assert.equal(JSON.parse(fs.readFileSync(a._cursorFile, 'utf-8')).cursor, 'c-1');
    const mtime1 = fs.statSync(a._cursorFile).mtimeMs;
    await pollOnce(a); // same cursor → no rewrite
    assert.equal(fs.statSync(a._cursorFile).mtimeMs, mtime1);
    cursor = 'c-2';
    await pollOnce(a);
    assert.equal(JSON.parse(fs.readFileSync(a._cursorFile, 'utf-8')).cursor, 'c-2');
  });

  it('restart: resumes from the persisted cursor instead of the head, and replays the missed message', async () => {
    const first = makeAdapter(tmp);
    first.client.pollPending = async () => ({ messages: [], cursor: 'c-before-crash' });
    await pollOnce(first);

    // A new adapter instance (daemon restart) for the same workspace+agent.
    const second = makeAdapter(tmp);
    let askedAfter = null;
    second.client.getHeadEventId = async () => { throw new Error('must not be called on resume'); };
    second.client.pollPending = async (_ws, _agent, _tok, { after }) => {
      askedAfter = after;
      return { messages: [msg('missed', 5 * 60 * 1000)], cursor: 'c-after' };
    };
    await second._skipExistingEvents();
    assert.equal(second._lastEventId, 'c-before-crash');
    assert.equal(second._resumedFromCursor, true);

    await pollOnce(second);
    assert.equal(askedAfter, 'c-before-crash');
    assert.equal(second.handled.length, 1);
    assert.equal(second.handled[0].content, 'm-missed');
    assert.equal(second.statuses.length, 0);
  });

  it('replay is bounded: messages older than the stale limit are skipped and the channel is told', async () => {
    fs.writeFileSync(path.join(tmp, 'cursor.json'), JSON.stringify({
      cursor: 'c-old', savedAt: Date.now() - 2 * 60 * 60 * 1000, workspaceId: 'ws-1', agentName: 'stub',
    }));
    const a = makeAdapter(tmp);
    a.client.pollPending = async () => ({
      messages: [
        msg('stale-1', STALE_MESSAGE_MAX_AGE_MS + 60_000),
        msg('stale-2', STALE_MESSAGE_MAX_AGE_MS + 30_000, { sessionId: 'other' }),
        msg('fresh', 2 * 60 * 1000),
      ],
      cursor: 'c-new',
    });
    await a._skipExistingEvents();
    await pollOnce(a);
    assert.deepEqual(a.handled.map((m) => m.content), ['m-fresh']);
    assert.equal(a.statuses.length, 2);
    assert.ok(a.statuses.every((s) => /Skipped 1 message/.test(s.text)));
    assert.deepEqual(a.statuses.map((s) => s.channel).sort(), ['general', 'other']);
  });

  it('age filter applies to the first poll after resume only — live polls are never age-filtered', async () => {
    fs.writeFileSync(path.join(tmp, 'cursor.json'), JSON.stringify({
      cursor: 'c-old', savedAt: Date.now() - 1000, workspaceId: 'ws-1', agentName: 'stub',
    }));
    const a = makeAdapter(tmp);
    let n = 0;
    a.client.pollPending = async () => {
      n++;
      // A wildly skewed local clock would make live messages look "old".
      return { messages: [msg(`m${n}`, STALE_MESSAGE_MAX_AGE_MS + 60_000)], cursor: `c-${n}` };
    };
    await a._skipExistingEvents();
    await pollOnce(a); // replay poll → skipped
    assert.equal(a.handled.length, 0);
    await pollOnce(a); // live poll → handled despite the timestamp
    assert.equal(a.handled.length, 1);
  });

  it('ignores a persisted cursor that is too old, or belongs to another workspace/agent', async () => {
    const write = (o) => fs.writeFileSync(path.join(tmp, 'cursor.json'), JSON.stringify(o));
    write({ cursor: 'c-ancient', savedAt: Date.now() - CURSOR_RESUME_MAX_AGE_MS - 1000, workspaceId: 'ws-1', agentName: 'stub' });
    let a = makeAdapter(tmp);
    await a._skipExistingEvents();
    assert.equal(a._lastEventId, 'head-1');

    write({ cursor: 'c-foreign', savedAt: Date.now(), workspaceId: 'ws-OTHER', agentName: 'stub' });
    a = makeAdapter(tmp);
    await a._skipExistingEvents();
    assert.equal(a._lastEventId, 'head-1');

    fs.writeFileSync(path.join(tmp, 'cursor.json'), '{not json');
    a = makeAdapter(tmp);
    await a._skipExistingEvents();
    assert.equal(a._lastEventId, 'head-1');
  });

  it('cursor file path is per workspace+agent and filesystem-safe', () => {
    const a = new StubAdapter({ workspaceId: 'ws/../x', agentName: 'my agent' });
    const f = a._cursorFilePath();
    assert.equal(path.basename(f), 'ws_.._x__my_agent.json');
    assert.ok(f.includes(path.join('.openagents', 'cursors')));
  });

  it('persistence failure is non-fatal', async () => {
    const a = makeAdapter(tmp);
    a._cursorFile = path.join(tmp, 'not-a-dir-file', 'cursor.json');
    fs.writeFileSync(path.join(tmp, 'not-a-dir-file'), 'x'); // mkdir will fail
    a.client.pollPending = async () => ({ messages: [msg('ok', 1000)], cursor: 'c-1' });
    await pollOnce(a);
    assert.equal(a.handled.length, 1);
  });
});
