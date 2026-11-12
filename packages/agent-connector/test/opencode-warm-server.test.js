'use strict';

/**
 * OpenCode turns on a warm server (OPENAGENTS_OPENCODE_SERVER=1): the server's
 * live events become the usual `opencode run --format json` events (thinking,
 * tool steps, reply; never the user's own prompt), parts the stream missed
 * come from the finished message, permission requests are answered, a stop
 * aborts the turn on the server, and a server that fails before any output
 * means the message runs the ordinary way. The server is faked here;
 * `child_process.spawn` too, for the ordinary runs.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const cp = require('node:child_process');

const realSpawn = cp.spawn;
let spawns = [];
cp.spawn = (cmd, args, opts) => {
  const proc = new EventEmitter();
  proc.pid = 4242;
  proc.exitCode = null;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = new EventEmitter();
  proc.stdin.write = () => true;
  proc.stdin.end = () => {};
  spawns.push({ cmd, args, opts });
  setImmediate(() => {
    proc.stdout.emit('data', Buffer.from('{"type":"text","part":{"type":"text","text":"from opencode run"}}\n', 'utf-8'));
    proc.exitCode = 0;
    proc.emit('close', 0, null);
  });
  return proc;
};

const OpenCodeAdapter = require('../src/adapters/opencode');
after(() => { cp.spawn = realSpawn; });

const part = (id, type, extra = {}) => ({ id, type, sessionID: 'ses_1', messageID: 'msg_a', ...extra });
const ended = { time: { start: 1, end: 2 } };

/** A fake warm server whose message request plays `live` events, then returns `final` parts. */
function fakeServer({ live = [], final = [], error = null, fail = null } = {}) {
  const listeners = new Set();
  const server = {
    acquired: 0, released: 0, stopped: 0, aborted: [], permissions: [], requests: [],
    acquire: async () => { server.acquired += 1; return true; },
    release: () => { server.released += 1; },
    stop: () => { server.stopped += 1; },
    abort: async (id) => { server.aborted.push(id); return true; },
    replyPermission: async (sid, id, reply) => { server.permissions.push([sid, id, reply]); return true; },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    request: async (method, path, body) => {
      server.requests.push([method, path, body]);
      if (path === '/session') return { id: 'ses_1' };
      if (fail) throw Object.assign(new Error('boom'), { status: fail });
      for (const ev of live) for (const fn of listeners) fn(ev);
      return { info: { id: 'msg_a', role: 'assistant', ...(error ? { error } : {}) }, parts: final };
    },
  };
  return server;
}

function makeAdapter(server, { enabled = true, sessionId = null } = {}) {
  const adapter = new OpenCodeAdapter({ workspaceId: 'ws', channelName: 'thread', token: 'token', agentName: 'oc-warm-test' });
  adapter._log = () => {};
  adapter.agentEnv = { ...process.env, OPENAGENTS_OPENCODE_SERVER: enabled ? '1' : '0' };
  adapter._opencodeBinary = '/fake/opencode';
  adapter._preflight = () => ({ ok: true, model: 'openagents-gateway/qwen', credential: 'present' });
  adapter._resolveModel = () => 'openagents-gateway/qwen';
  adapter._ensureWorkspaceSkill = () => {};
  adapter._buildSystemContext = () => '';
  adapter._wiresWorkspaceMcp = () => false;
  adapter._saveSessions = () => {};
  adapter._channelSessions = sessionId ? { thread: sessionId } : {};
  adapter._server = server;
  const posted = [];
  adapter.sendThinking = async (_ch, text) => { posted.push(['thinking', text]); };
  adapter.sendStatus = async (_ch, text) => { posted.push(['status', text]); };
  return { adapter, posted };
}

const userMsg = { type: 'message.updated', properties: { info: { id: 'msg_u', role: 'user', sessionID: 'ses_1' } } };
const asstMsg = { type: 'message.updated', properties: { info: { id: 'msg_a', role: 'assistant', sessionID: 'ses_1' } } };
const updated = (p) => ({ type: 'message.part.updated', properties: { part: p } });

describe('OpenCode — warm server', { skip: process.platform === 'win32' && 'the warm server is not used on Windows' }, () => {
  it('shows thinking, tool steps and the reply live, never the user prompt', async () => {
    const thinking = part('p1', 'reasoning', { text: 'Thinking it over', ...ended });
    const tool = part('p2', 'tool', { tool: 'bash', state: { status: 'completed', input: { command: 'ls' } } });
    const reply = part('p3', 'text', { text: 'All done.', ...ended });
    const server = fakeServer({
      live: [userMsg, updated(part('u1', 'text', { messageID: 'msg_u', text: 'the prompt', ...ended })), asstMsg,
        updated(part('p0', 'step-start')), updated(part('p1', 'reasoning', { text: 'Think' })), updated(thinking), updated(tool), updated(reply)],
      final: [part('p0', 'step-start'), thinking, tool, reply, part('p4', 'step-finish')],
    });
    const { adapter, posted } = makeAdapter(server);
    assert.equal(await adapter._runOpencode('hello', 'thread'), 'All done.');
    // Same traces as `opencode run`: the reasoning, then the reply text (posted as a trace too).
    assert.deepEqual(posted.filter(([k]) => k === 'thinking').map(([, t]) => t), ['Thinking it over', 'All done.']);
    assert.ok(posted.some(([k, t]) => k === 'status' && /bash/.test(t)));
    assert.equal(posted.some(([, t]) => /the prompt/.test(t)), false);
    assert.equal(spawns.length, 0);
    assert.equal(server.released, 1);
  });

  it('takes parts the live stream missed from the finished message, and keeps the session', async () => {
    const server = fakeServer({ final: [part('p1', 'reasoning', { text: 'Quiet thought', ...ended }), part('p2', 'text', { text: 'Reply.', ...ended })] });
    const { adapter, posted } = makeAdapter(server);
    assert.equal(await adapter._runOpencode('hello', 'thread'), 'Reply.');
    assert.deepEqual(posted.filter(([k]) => k === 'thinking').map(([, t]) => t), ['Quiet thought', 'Reply.']);
    assert.equal(adapter._channelSessions.thread, 'ses_1');
    const [, path, body] = server.requests.find(([, p]) => p.endsWith('/message'));
    assert.equal(path, '/session/ses_1/message');
    assert.deepEqual(body.model, { providerID: 'openagents-gateway', modelID: 'qwen' });
  });

  it('answers permission requests for its session', async () => {
    const server = fakeServer({
      live: [{ type: 'permission.asked', properties: { id: 'per_1', sessionID: 'ses_1', permission: 'bash' } },
        { type: 'permission.asked', properties: { id: 'per_2', sessionID: 'ses_other', permission: 'bash' } }],
      final: [part('p2', 'text', { text: 'ok', ...ended })],
    });
    const { adapter } = makeAdapter(server, { sessionId: 'ses_1' });
    await adapter._runOpencode('hello', 'thread');
    assert.deepEqual(server.permissions, [['ses_1', 'per_1', 'once']]);
  });

  it('fails like opencode run when the turn ends in an error', async () => {
    const server = fakeServer({ final: [], error: { name: 'ProviderAuthError', data: { message: 'Invalid API key' } } });
    const { adapter } = makeAdapter(server, { sessionId: 'ses_1' });
    await assert.rejects(adapter._runOpencode('hello', 'thread'));
  });

  it('runs the ordinary way when the server fails before any output', async () => {
    spawns = [];
    const server = fakeServer({ fail: 500 });
    const { adapter } = makeAdapter(server, { sessionId: 'ses_1' });
    assert.equal(await adapter._runOpencode('hello', 'thread'), 'from opencode run');
    assert.equal(spawns.length, 1);
    assert.equal(server.stopped, 1);
    assert.equal(server.released, 1);
  });

  it('keeps the server for an unknown session, and runs that message the ordinary way', async () => {
    spawns = [];
    const server = fakeServer({ fail: 404 });
    const { adapter } = makeAdapter(server, { sessionId: 'ses_gone' });
    assert.equal(await adapter._runOpencode('hello', 'thread'), 'from opencode run');
    assert.equal(server.stopped, 0);
  });

  it('runs the ordinary way when not enabled', async () => {
    spawns = [];
    const server = fakeServer();
    const { adapter } = makeAdapter(server, { enabled: false });
    assert.equal(await adapter._runOpencode('hello', 'thread'), 'from opencode run');
    assert.equal(server.acquired, 0);
  });

  it('serves every channel with one setup, telling the tools which channel each turn is for', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-warm-'));
    try {
      const envs = [];
      const contexts = [];
      const server = fakeServer({ final: [part('p2', 'text', { text: 'ok', ...ended })] });
      server.acquire = async ({ env }) => { envs.push(env.OPENCODE_CONFIG_CONTENT); return true; };
      const request = server.request;
      server.request = async (method, p, body) => {
        if (p.endsWith('/message')) contexts.push(JSON.parse(fs.readFileSync(path.join(home, 'opencode-turn-context.json'), 'utf-8')));
        return request(method, p, body);
      };
      const { adapter } = makeAdapter(server, { sessionId: 'ses_1' });
      adapter.agentHome = home;
      adapter._wiresWorkspaceMcp = () => true;
      adapter.requesterEmailFor = (ch) => `${ch}@example.test`;
      await adapter._runOpencode('hello', 'thread-a');
      await adapter._runOpencode('hello', 'thread-b');
      assert.equal(envs.length, 2);
      assert.equal(envs[0], envs[1]);  // one server setup for both channels
      assert.match(envs[0], /--context-file/);
      assert.deepEqual(contexts, [
        { channel: 'thread-a', requesterEmail: 'thread-a@example.test' },
        { channel: 'thread-b', requesterEmail: 'thread-b@example.test' },
      ]);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it("the Workspace tools follow the turn's context file", () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { McpServer } = require('../src/mcp-server');
    const file = path.join(os.tmpdir(), `oc-ctx-${process.pid}.json`);
    try {
      const tools = new McpServer({ wsClient: {}, workspaceId: 'ws', channelName: 'general', agentName: 'a', token: 't', contextFile: file });
      assert.equal(tools.channelName, 'general');  // no file yet
      fs.writeFileSync(file, JSON.stringify({ channel: 'thread-b', requesterEmail: 'b@example.test' }));
      assert.equal(tools.channelName, 'thread-b');
      assert.equal(tools.requesterEmail, 'b@example.test');
    } finally { fs.rmSync(file, { force: true }); }
  });

  it('a stop aborts the turn on the server', async () => {
    const server = fakeServer();
    const { adapter } = makeAdapter(server);
    const proc = new EventEmitter();
    proc.exitCode = 0;
    proc.__abortAttached = () => server.abort('ses_1');
    await adapter._stopProcess(proc);
    assert.deepEqual(server.aborted, ['ses_1']);
  });
});
