'use strict';

/**
 * NanoClaw bridge tests.
 *
 * Exercises the OpenAgents-side adapter + protocol/control/bridge/install/store
 * modules against a MOCK NanoClaw runtime: a fake `ncl.sock` control server and
 * a fake `openagents` channel server (real Unix sockets) that MIRRORS the real
 * channel's security handshake + at-least-once ACK/replay so the bridge contract
 * is exercised end to end. Only NanoClaw itself and the Workspace client are
 * mocked. The real channel's TypeScript is verified separately by a strict
 * typecheck against NanoClaw's adapter.ts.
 *
 * Covers: detection, control client, local-IPC security (dir/secret/socket
 * perms, symlink refusal, handshake auth, pre-auth frame drops, re-auth on
 * reconnect), agent-group selection, send/receive, per-channel + multi-workspace
 * isolation, persistent ACK + dedup + replay (incl. across a bridge restart),
 * loop/echo guard, timeout, detach (stop = stop-waiting, not cancel), abnormal
 * exit, redaction, cleanup that spares shared services, and the version-gated
 * rollback-safe channel installer.
 */

const { test: _test } = require('node:test');
// The NanoClaw bridge is Unix-domain-socket IPC (filesystem sockets + symlink
// checks). These tests can't run on Windows (EACCES on AF_UNIX paths, no POSIX
// symlink semantics), so skip the whole file there; Unix coverage is unchanged.
const test = process.platform === 'win32' ? _test.skip : _test;
const assert = require('node:assert');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const proto = require('../src/adapters/nanoclaw-protocol');
const control = require('../src/adapters/nanoclaw-control');
const {
  NclControl,
  findNanoclawHome,
  looksLikeNanoclaw,
  bridgeSocketPath,
  bridgeSocketDir,
  bridgeSecretPath,
  ensureSecureDir,
  readBridgeSecret,
  safeUnlinkSocket,
  isPathSafe,
} = control;
const { NanoclawBridge } = require('../src/adapters/nanoclaw-bridge');
const NanoClawAdapter = require('../src/adapters/nanoclaw');
const channelInstall = require('../src/adapters/nanoclaw-channel-install');
const { DeliveryStore } = require('../src/adapters/nanoclaw-delivery-store');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nctest-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  return dir;
}
function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs = 2000, stepMs = 10) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await sleep(stepMs);
  }
  return false;
}

/** Fake NanoClaw control socket (data/ncl.sock). */
class MockNcl {
  constructor(socketPath, state = {}) {
    this.socketPath = socketPath;
    this.state = {
      groups: state.groups || [],
      wirings: state.wirings || [],
      messagingGroups: state.messagingGroups || {},
      sessions: state.sessions || [],
    };
    this.server = null;
    this.requests = [];
  }
  start() {
    return new Promise((resolve, reject) => {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        /* ignore */
      }
      this.server = net.createServer((conn) => {
        let buf = '';
        conn.on('error', () => {});
        conn.on('data', (chunk) => {
          buf += chunk.toString('utf8');
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (!line.trim()) continue;
            let req;
            try {
              req = JSON.parse(line);
            } catch {
              continue;
            }
            this.requests.push(req);
            conn.write(JSON.stringify(this._handle(req)) + '\n');
          }
        });
      });
      this.server.on('error', reject);
      this.server.listen(this.socketPath, () => resolve());
    });
  }
  _handle(req) {
    const { id, command, args = {} } = req;
    const ok = (data) => ({ id, ok: true, data });
    const err = (code, message) => ({ id, ok: false, error: { code, message } });
    switch (command) {
      case 'groups-list':
        return ok(this.state.groups);
      case 'groups-get':
        return ok(this.state.groups.find((g) => g.id === args.id) || null);
      case 'wirings-list': {
        let rows = this.state.wirings;
        if (args.agent_group_id) rows = rows.filter((w) => w.agent_group_id === args.agent_group_id);
        return ok(rows);
      }
      case 'messaging-groups-list':
        return ok(Object.values(this.state.messagingGroups));
      case 'messaging-groups-get':
        return ok(this.state.messagingGroups[args.id] || null);
      case 'sessions-list': {
        let rows = this.state.sessions;
        if (args.agent_group_id) rows = rows.filter((s) => s.agent_group_id === args.agent_group_id);
        return ok(rows);
      }
      default:
        return err('unknown-command', `no command ${command}`);
    }
  }
  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }
  isListening() {
    return !!(this.server && this.server.listening);
  }
}

function sha256hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Fake native `openagents` channel. MIRRORS the real channel: 0600 secret +
 * handshake gate, single-connection rejection, turnId tagging, and a PERSISTENT
 * on-disk outbox (so un-ACKed replies survive a channel/host "restart" = a new
 * MockChannel instance on the same home). Used to exercise the bridge contract
 * end to end. The real channel's TypeScript is verified separately by strict
 * typecheck against NanoClaw's adapter.ts.
 */
class MockChannel {
  constructor(home, opts = {}) {
    this.home = home;
    this.socketPath = bridgeSocketPath(home);
    this.outboxDir = path.join(bridgeSocketDir(home), 'outbox');
    this.secret = opts.secret || crypto.randomBytes(16).toString('hex');
    this.maxOutbox = opts.maxOutbox || 1000;
    this.ttlMs = opts.ttlMs || 24 * 60 * 60 * 1000;
    this.received = [];
    this.acks = [];
    this.cancels = [];
    this.rejected = [];
    this.dropped = [];
    this.outbox = new Map(); // outId → record
    this.lastTurn = new Map();
    this._onInbound = opts.onInbound || null;
    this.autoReply = opts.autoReply !== false;
    this.replyDelayMs = opts.replyDelayMs || 20;
    this._outSeq = 0;
    this.authedClient = null;
    this.server = null;
  }
  writeSecret() {
    const dir = bridgeSocketDir(this.home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.outboxDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(dir, 0o700);
      fs.chmodSync(this.outboxDir, 0o700);
    } catch {
      /* ignore */
    }
    fs.writeFileSync(bridgeSecretPath(this.home), this.secret, { mode: 0o600 });
    try {
      fs.chmodSync(bridgeSecretPath(this.home), 0o600);
    } catch {
      /* ignore */
    }
  }
  _recFile(outId) {
    return path.join(this.outboxDir, sha256hex(outId) + '.json');
  }
  _line(rec) {
    return (
      JSON.stringify({ op: 'outbound', platformId: rec.platformId, threadId: rec.threadId, outId: rec.outId, turnId: rec.turnId, kind: rec.kind, text: rec.text, ts: new Date(rec.ts).toISOString() }) + '\n'
    );
  }
  _persist(rec) {
    try {
      fs.writeFileSync(this._recFile(rec.outId), JSON.stringify(rec), { mode: 0o600 });
      fs.chmodSync(this._recFile(rec.outId), 0o600);
    } catch {
      /* best-effort, mirrors the real channel (e.g. dir gone after teardown) */
    }
  }
  _del(outId) {
    this.outbox.delete(outId);
    try {
      fs.unlinkSync(this._recFile(outId));
    } catch {
      /* ignore */
    }
  }
  _quarantine(name) {
    try {
      const cdir = path.join(this.outboxDir, 'corrupt');
      fs.mkdirSync(cdir, { recursive: true, mode: 0o700 });
      fs.renameSync(path.join(this.outboxDir, name), path.join(cdir, `${Date.now()}-${name}`));
    } catch {
      /* ignore */
    }
    this.corruptCount = (this.corruptCount || 0) + 1;
  }
  _load() {
    let files = [];
    try {
      files = fs.readdirSync(this.outboxDir);
    } catch {
      return;
    }
    const recs = [];
    for (const n of files) {
      if (n === 'corrupt') continue;
      if (n.endsWith('.tmp')) continue; // interrupted write — ignore, never load a partial
      if (!n.endsWith('.json')) continue;
      let rec = null;
      try {
        rec = JSON.parse(fs.readFileSync(path.join(this.outboxDir, n), 'utf-8'));
      } catch {
        this._quarantine(n);
        continue;
      }
      if (rec && typeof rec.outId === 'string' && typeof rec.platformId === 'string' && typeof rec.ts === 'number') {
        recs.push(rec);
      } else {
        this._quarantine(n);
      }
    }
    recs.sort((a, b) => a.ts - b.ts);
    for (const r of recs) this.outbox.set(r.outId, r);
    this._pruneExpired();
  }
  _pruneExpired() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, rec] of this.outbox) {
      if (rec.ts < cutoff) {
        this._del(id);
        this._emitDropped(rec, 'expired');
      }
    }
  }
  _enforceCap() {
    while (this.outbox.size >= this.maxOutbox) {
      const id = this.outbox.keys().next().value;
      if (id === undefined) break;
      const rec = this.outbox.get(id);
      this._del(id);
      this._emitDropped(rec, 'overflow');
    }
  }
  _emitDropped(rec, reason) {
    this.dropped.push({ outId: rec.outId, reason });
    if (this.authedClient) {
      try {
        this.authedClient.write(JSON.stringify({ op: 'dropped', outId: rec.outId, platformId: rec.platformId, reason }) + '\n');
      } catch {
        /* ignore */
      }
    }
  }
  start() {
    this.writeSecret();
    this._load(); // reload un-ACKed from disk (channel/host restart)
    return new Promise((resolve, reject) => {
      safeUnlinkSocket(this.socketPath);
      this.server = net.createServer((socket) => this._onConn(socket));
      this.server.on('error', reject);
      this.server.listen(this.socketPath, () => {
        try {
          fs.chmodSync(this.socketPath, 0o600);
        } catch {
          /* ignore */
        }
        resolve();
      });
    });
  }
  _onConn(socket) {
    const ctx = { authed: false };
    socket.on('error', () => {});
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let f;
        try {
          f = JSON.parse(line);
        } catch {
          continue;
        }
        this._onFrame(f, socket, ctx);
      }
    });
    socket.on('close', () => {
      if (this.authedClient === socket) this.authedClient = null;
    });
  }
  _reject(socket, code) {
    this.rejected.push(code);
    try {
      socket.write(JSON.stringify({ op: 'error', code, message: 'handshake rejected' }) + '\n');
      socket.destroy();
    } catch {
      /* ignore */
    }
  }
  _onFrame(f, socket, ctx) {
    if (f.op === 'ping') {
      socket.write(JSON.stringify({ op: 'pong' }) + '\n');
      return;
    }
    if (f.op === 'hello') {
      if (f.protocol !== proto.PROTOCOL_VERSION) return this._reject(socket, 'incompatible_version');
      if (this.authedClient && this.authedClient !== socket && !this.authedClient.destroyed) {
        return this._reject(socket, 'single_connection');
      }
      if (f.secret !== this.secret) return this._reject(socket, 'auth_failed');
      ctx.authed = true;
      this.authedClient = socket;
      socket.write(JSON.stringify({ op: 'ready', channelType: 'openagents', protocol: 1 }) + '\n');
      this._pruneExpired();
      for (const rec of this.outbox.values()) socket.write(this._line(rec));
      if (this.corruptCount > 0) {
        socket.write(JSON.stringify({ op: 'dropped', reason: 'corrupt', platformId: null, count: this.corruptCount }) + '\n');
        this.corruptCount = 0;
      }
      return;
    }
    if (!ctx.authed) return; // pre-handshake frame dropped
    if (f.op === 'ack') {
      this.acks.push(f);
      const rec = this.outbox.get(f.outId);
      if (rec && (!f.platformId || rec.platformId === f.platformId)) this._del(f.outId);
      return;
    }
    if (f.op === 'inbound') {
      this.received.push(f);
      if (typeof f.turnId === 'string') this.lastTurn.set(f.platformId, f.turnId);
      const api = {
        // Mirror NanoClaw: outbound is stamped with the triggering inbound's
        // authoritative thread_id.
        outbound: (text, extra = {}) =>
          this.emit({ op: 'outbound', platformId: f.platformId, threadId: f.threadId ?? null, text, ...extra }),
        status: (state) => this.emit({ op: 'status', platformId: f.platformId, state }),
        error: (message) => this.emit({ op: 'error', platformId: f.platformId, message }),
      };
      if (this._onInbound) this._onInbound(f, api);
      else if (this.autoReply) setTimeout(() => api.outbound(`echo: ${f.text}`), this.replyDelayMs);
      return;
    }
    if (f.op === 'cancel') {
      this.cancels.push(f);
      return;
    }
  }
  emit(obj) {
    if (obj.op === 'outbound') {
      this._pruneExpired();
      this._enforceCap();
      if (!obj.outId) {
        this._outSeq += 1;
        obj.outId = `${obj.platformId}#${this._outSeq}`;
      }
      const rec = {
        outId: obj.outId,
        platformId: obj.platformId,
        threadId: obj.threadId ?? null,
        turnId: obj.turnId ?? this.lastTurn.get(obj.platformId) ?? null,
        sessionKey: obj.platformId,
        kind: obj.kind || 'chat',
        text: obj.text,
        ts: obj.ts || Date.now(),
      };
      this.outbox.set(rec.outId, rec);
      this._persist(rec);
      if (this.authedClient) {
        try {
          this.authedClient.write(this._line(rec));
        } catch {
          /* ignore */
        }
      }
    } else if (this.authedClient) {
      try {
        this.authedClient.write(JSON.stringify(obj) + '\n');
      } catch {
        /* ignore */
      }
    }
  }
  outboxSize() {
    return this.outbox.size;
  }
  stop() {
    return new Promise((resolve) => {
      if (this.authedClient) {
        try {
          this.authedClient.destroy();
        } catch {
          /* ignore */
        }
      }
      this.authedClient = null;
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }
}

class MockWorkspaceClient {
  constructor() {
    this.events = [];
  }
  async sendMessage(ws, channel, token, content, opts = {}) {
    this.events.push({ channel, content, type: opts.messageType || 'chat', meta: opts.metadata || {} });
  }
  async getSession() {
    return { title: 'New chat', titleManuallySet: false };
  }
  async updateSession() {}
  responses(channel) {
    return this.events.filter((e) => e.channel === channel && e.type === 'chat');
  }
  statuses(channel) {
    return this.events.filter((e) => e.channel === channel && e.type === 'status');
  }
}

const GROUP = { id: 'ag-1', name: 'Andy', folder: 'main', agent_provider: 'claude', created_at: 't' };
function defaultNclState() {
  return {
    groups: [GROUP],
    wirings: [{ id: 'w1', messaging_group_id: 'mg-1', agent_group_id: 'ag-1', engage_mode: 'mention' }],
    messagingGroups: { 'mg-1': { id: 'mg-1', channel_type: 'openagents', platform_id: 'oa:ws1:general' } },
    sessions: [{ id: 'sess-1', agent_group_id: 'ag-1', messaging_group_id: 'mg-1', container_status: 'running' }],
  };
}

async function makeRig(t, { nclState, channelOpts, env, workspaceId = 'ws1', startChannel = true } = {}) {
  const home = tmpHome();
  const stateDir = path.join(home, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const ncl = new MockNcl(path.join(home, 'data', 'ncl.sock'), nclState || defaultNclState());
  const channel = new MockChannel(home, channelOpts || {});
  await ncl.start();
  if (startChannel) await channel.start();
  else channel.writeSecret(); // secret exists so the bridge can read it on connect

  const logs = [];
  const adapter = new NanoClawAdapter({
    workspaceId,
    channelName: 'general',
    token: 'SECRET-TOKEN-abcdef123456',
    agentName: 'Andy',
    endpoint: 'http://127.0.0.1:1/none',
    agentEnv: Object.assign(
      {
        NANOCLAW_HOME: home,
        NANOCLAW_AGENT_GROUP: 'ag-1',
        NANOCLAW_STATE_DIR: stateDir,
        NANOCLAW_REPLY_TIMEOUT_MS: '500',
        NANOCLAW_REPLY_SILENCE_MS: '120',
        NANOCLAW_CONNECT_TIMEOUT_MS: '1000',
        NANOCLAW_DETACH_QUIET_MS: '150',
        NANOCLAW_DETACH_TTL_MS: '3000',
      },
      env || {},
    ),
  });
  const wsClient = new MockWorkspaceClient();
  adapter.client = wsClient;
  adapter._log = (m) => logs.push(String(m));

  await adapter._startBridge();
  if (startChannel) await waitFor(() => adapter._bridge && adapter._bridge.isReady(), 2000);

  t.after(async () => {
    adapter.stop();
    await channel.stop();
    await ncl.stop();
    rmrf(home);
  });

  return { home, stateDir, ncl, channel, adapter, wsClient, logs };
}

function userMsg(text, sessionId, id) {
  return { id: id || `m-${Math.random().toString(36).slice(2)}`, content: text, sessionId, senderType: 'user', senderName: 'Alice' };
}

// ===========================================================================
// Pure protocol
// ===========================================================================

test('protocol: platformId stable + reversible; foreign ids rejected', () => {
  const pid = proto.platformIdFor('ws1', 'general');
  assert.equal(pid, 'oa:ws1:general');
  assert.equal(proto.channelFromPlatformId(pid, 'ws1'), 'general');
  assert.equal(proto.channelFromPlatformId(pid, 'ws2'), null);
  assert.equal(proto.channelFromPlatformId('whatsapp:123', 'ws1'), null);
});

test('protocol: makeMessageId stable per source, unique across', () => {
  assert.equal(proto.makeMessageId({ id: 'm1' }, 'ws1'), proto.makeMessageId({ id: 'm1' }, 'ws1'));
  assert.notEqual(proto.makeMessageId({ id: 'm1' }, 'ws1'), proto.makeMessageId({ id: 'm2' }, 'ws1'));
});

test('protocol: shouldForwardInbound blocks echoes/agent output/empties', () => {
  assert.equal(proto.shouldForwardInbound({ content: 'hi', senderType: 'user' }, 'Andy'), true);
  assert.equal(proto.shouldForwardInbound({ content: 'hi', senderType: 'agent' }, 'Andy'), false);
  assert.equal(proto.shouldForwardInbound({ content: 'hi', senderName: 'Andy' }, 'Andy'), false);
  assert.equal(proto.shouldForwardInbound({ content: '   ' }, 'Andy'), false);
});

test('protocol: hello carries the secret; ack carries platform context', () => {
  assert.ok(proto.buildHello('w', 'a', 'TOPSECRET').includes('TOPSECRET'));
  const ack = JSON.parse(proto.buildAck('o1', 'oa:ws1:c'));
  assert.deepEqual(ack, { op: 'ack', outId: 'o1', platformId: 'oa:ws1:c' });
});

test('protocol: redaction scrubs tokens, bearer, cookies + explicit secrets', () => {
  const s = proto.redactSecrets('Bearer sk-ant-api03-XXXXXXXXXXXX cookie: sid=abc token=MYTOKEN123456', ['MYTOKEN123456']);
  assert.ok(!s.includes('sk-ant-api03-XXXXXXXXXXXX') && !s.includes('MYTOKEN123456') && !s.includes('sid=abc'));
});

test('protocol: parseFrames handles partial chunks + garbage', () => {
  let r = proto.parseFrames('{"op":"a"}\n{"op":"b"}\n{"op":"c');
  assert.deepEqual(r.frames.map((f) => f.op), ['a', 'b']);
  r = proto.parseFrames(r.rest + '"}\nnot json\n{"op":"d"}\n');
  assert.deepEqual(r.frames.map((f) => f.op), ['c', 'd']);
});

test('protocol: classifyError maps distinct categories incl. auth/version', () => {
  assert.equal(proto.classifyError({ code: proto.ERR.AUTH_FAILED }).code, proto.ERR.AUTH_FAILED);
  assert.equal(proto.classifyError({ code: proto.ERR.INCOMPATIBLE_VERSION }).code, proto.ERR.INCOMPATIBLE_VERSION);
  assert.equal(proto.classifyError(new Error('docker daemon is not running')).code, proto.ERR.DOCKER_UNAVAILABLE);
});

// ===========================================================================
// Detection
// ===========================================================================

test('detection: findNanoclawHome honors NANOCLAW_HOME; looksLikeNanoclaw by pkg', () => {
  const home = tmpHome();
  try {
    assert.equal(findNanoclawHome({ NANOCLAW_HOME: home }).home, home);
    fs.writeFileSync(path.join(home, 'package.json'), JSON.stringify({ name: 'nanoclaw' }));
    assert.equal(looksLikeNanoclaw(home), true);
    assert.equal(looksLikeNanoclaw('/no/such/dir'), false);
  } finally {
    rmrf(home);
  }
});

test('detection: adapter reports NOT_INSTALLED when no home', async () => {
  const adapter = new NanoClawAdapter({
    workspaceId: 'ws1',
    channelName: 'general',
    token: 't',
    agentName: 'Andy',
    endpoint: 'http://127.0.0.1:1/none',
    agentEnv: { NANOCLAW_HOME: '/definitely/not/here', HOME: '/definitely/not/here' },
  });
  adapter._home = null;
  const wsClient = new MockWorkspaceClient();
  adapter.client = wsClient;
  await adapter._handleMessage(userMsg('hello', 'general'));
  assert.match(wsClient.responses('general')[0].content, /not installed|could not be found/i);
  adapter.stop();
});

// ===========================================================================
// Control client
// ===========================================================================

test('control: list groups/sessions/wirings + ping; missing socket → error', async (t) => {
  const home = tmpHome();
  const ncl = new MockNcl(path.join(home, 'data', 'ncl.sock'), defaultNclState());
  await ncl.start();
  t.after(async () => {
    await ncl.stop();
    rmrf(home);
  });
  const ctl = new NclControl(path.join(home, 'data', 'ncl.sock'));
  assert.equal(await ctl.ping(), true);
  assert.equal((await ctl.listGroups())[0].id, 'ag-1');
  assert.equal((await ctl.listSessions({ agent_group_id: 'ag-1' }))[0].id, 'sess-1');
  assert.equal((await ctl.listWirings({ agent_group_id: 'ag-1' })).length, 1);

  const dead = new NclControl(path.join(os.tmpdir(), `nope-${Date.now()}.sock`), { timeoutMs: 400 });
  await assert.rejects(() => dead.ping());
});

// ===========================================================================
// Area 1 — local-IPC security
// ===========================================================================

test('security: ensureSecureDir creates 0700 and rejects symlinked dir', () => {
  const home = tmpHome();
  try {
    const dir = path.join(home, 'data', 'openagents');
    const r = ensureSecureDir(dir);
    assert.equal(r.ok, true);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    }
    // symlinked dir → refused
    const linkTarget = path.join(home, 'elsewhere');
    fs.mkdirSync(linkTarget);
    const linkDir = path.join(home, 'data', 'linkdir');
    fs.symlinkSync(linkTarget, linkDir);
    assert.equal(ensureSecureDir(linkDir).ok, false);
  } finally {
    rmrf(home);
  }
});

test('security: readBridgeSecret reads 0600, rejects symlink + group-readable', () => {
  const home = tmpHome();
  try {
    const dir = bridgeSocketDir(home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const sp = bridgeSecretPath(home);
    fs.writeFileSync(sp, 'topsecret', { mode: 0o600 });
    fs.chmodSync(sp, 0o600);
    assert.equal(readBridgeSecret(home), 'topsecret');
    if (process.platform !== 'win32') {
      fs.chmodSync(sp, 0o644); // group/other-readable → refuse
      assert.equal(readBridgeSecret(home), null);
      fs.chmodSync(sp, 0o600);
      // symlinked secret → refuse
      fs.unlinkSync(sp);
      const real = path.join(home, 'realsecret');
      fs.writeFileSync(real, 'x', { mode: 0o600 });
      fs.symlinkSync(real, sp);
      assert.equal(readBridgeSecret(home), null);
    }
  } finally {
    rmrf(home);
  }
});

test('security: safeUnlinkSocket only removes sockets, never files/symlinks', async () => {
  const home = tmpHome();
  try {
    // a real socket
    const sockPath = path.join(home, 'real.sock');
    await new Promise((res) => {
      const s = net.createServer();
      s.on('error', () => {}); // macOS can emit 'error' on close after the path is gone
      s.listen(sockPath, () => s.close(() => res()));
    });
    // server closed but file may remain; recreate to be sure it's a socket
    const srv = net.createServer();
    // We unlink its socket file below WHILE it is still listening; on macOS the
    // subsequent close() hits ENOENT on its internal unlink and emits 'error'.
    // Without a listener that's an uncaughtException that fails the whole run.
    srv.on('error', () => {});
    await new Promise((res) => srv.listen(path.join(home, 's2.sock'), res));
    const s2 = path.join(home, 's2.sock');
    assert.equal(safeUnlinkSocket(s2).removed, true);
    await new Promise((res) => srv.close(res));

    // a regular file → refused
    const reg = path.join(home, 'important.txt');
    fs.writeFileSync(reg, 'do not delete');
    assert.equal(safeUnlinkSocket(reg).removed, false);
    assert.ok(fs.existsSync(reg));

    // a symlink → refused
    const link = path.join(home, 'link.sock');
    fs.symlinkSync(reg, link);
    assert.equal(safeUnlinkSocket(link).removed, false);
    assert.ok(fs.existsSync(reg));
  } finally {
    rmrf(home);
  }
});

test('security: isPathSafe flags symlinks', () => {
  const home = tmpHome();
  try {
    const f = path.join(home, 'f');
    fs.writeFileSync(f, 'x');
    assert.equal(isPathSafe(f).ok, true);
    const l = path.join(home, 'l');
    fs.symlinkSync(f, l);
    assert.equal(isPathSafe(l).ok, false);
  } finally {
    rmrf(home);
  }
});

test('security: bridge refuses a symlinked socket path', async (t) => {
  const home = tmpHome();
  fs.mkdirSync(bridgeSocketDir(home), { recursive: true });
  const real = path.join(home, 'data', 'real.sock');
  fs.writeFileSync(real, 'x');
  fs.symlinkSync(real, bridgeSocketPath(home));
  const bridge = new NanoclawBridge(bridgeSocketPath(home), { secretProvider: () => 'sec', minBackoffMs: 50 });
  let unsafe = false;
  bridge.on('socket-error', (e) => {
    if (e.code === 'UNSAFE_PATH') unsafe = true;
  });
  bridge.connect();
  t.after(() => {
    bridge.close();
    rmrf(home);
  });
  assert.ok(await waitFor(() => unsafe, 1000), 'bridge should refuse symlinked socket');
  assert.equal(bridge.isReady(), false);
});

test('security: channel rejects wrong secret, protocol mismatch, and pre-auth frames', async (t) => {
  const home = tmpHome();
  const channel = new MockChannel(home, { autoReply: false });
  await channel.start();
  t.after(async () => {
    await channel.stop();
    rmrf(home);
  });

  function rawSend(lineObjs) {
    return new Promise((resolve) => {
      const c = net.connect(channel.socketPath);
      const got = [];
      let buf = '';
      c.on('error', () => {});
      c.on('data', (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (l.trim()) got.push(JSON.parse(l));
        }
      });
      c.on('connect', () => {
        for (const o of lineObjs) c.write(JSON.stringify(o) + '\n');
      });
      setTimeout(() => {
        try {
          c.destroy();
        } catch {
          /* ignore */
        }
        resolve(got);
      }, 120);
    });
  }

  // wrong secret → rejected, no ready
  const r1 = await rawSend([{ op: 'hello', protocol: 1, secret: 'WRONG' }]);
  assert.ok(!r1.some((f) => f.op === 'ready'));
  assert.ok(channel.rejected.includes('auth_failed'));

  // protocol mismatch → rejected
  const r2 = await rawSend([{ op: 'hello', protocol: 999, secret: channel.secret }]);
  assert.ok(!r2.some((f) => f.op === 'ready'));
  assert.ok(channel.rejected.includes('incompatible_version'));

  // pre-auth inbound is dropped (never reaches received)
  await rawSend([{ op: 'inbound', platformId: 'oa:ws1:x', msgId: 'm', text: 'sneaky' }]);
  assert.equal(channel.received.length, 0);

  // valid hello → ready
  const r3 = await rawSend([{ op: 'hello', protocol: 1, secret: channel.secret }]);
  assert.ok(r3.some((f) => f.op === 'ready'));
});

test('security: bridge surfaces auth-failed on wrong secret', async (t) => {
  const home = tmpHome();
  const channel = new MockChannel(home, { autoReply: false });
  await channel.start();
  const bridge = new NanoclawBridge(channel.socketPath, { secretProvider: () => 'WRONG-SECRET', minBackoffMs: 50, maxBackoffMs: 100 });
  let authFailed = false;
  bridge.on('auth-failed', () => {
    authFailed = true;
  });
  bridge.connect();
  t.after(async () => {
    bridge.close();
    await channel.stop();
    rmrf(home);
  });
  assert.ok(await waitFor(() => authFailed, 1500), 'bridge should report auth-failed');
  assert.equal(bridge.isReady(), false);
});

test('security: bridge waits (no connect) when secret is absent', async (t) => {
  const home = tmpHome();
  const channel = new MockChannel(home, { autoReply: false });
  await channel.start();
  // secretProvider returns null → bridge must not become ready
  const bridge = new NanoclawBridge(channel.socketPath, { secretProvider: () => null, minBackoffMs: 50 });
  bridge.connect();
  t.after(async () => {
    bridge.close();
    await channel.stop();
    rmrf(home);
  });
  await sleep(300);
  assert.equal(bridge.isReady(), false);
});

// ===========================================================================
// Bridge handshake / inbound / outbound / ack / reconnect
// ===========================================================================

test('bridge: handshake (secret) → ready; inbound delivered; outbound received + ACKed', async (t) => {
  const home = tmpHome();
  const channel = new MockChannel(home);
  await channel.start();
  const bridge = new NanoclawBridge(channel.socketPath, { workspace: 'ws1', agent: 'Andy', secretProvider: () => readBridgeSecret(home) });
  const outs = [];
  bridge.on('outbound', (f) => {
    outs.push(f);
    bridge.sendAck(f.outId, f.platformId);
  });
  bridge.connect();
  t.after(async () => {
    bridge.close();
    await channel.stop();
    rmrf(home);
  });
  assert.ok(await waitFor(() => bridge.isReady()), 'ready after valid handshake');
  bridge.sendInbound({ platformId: 'oa:ws1:general', msgId: 'm1', text: 'hi' });
  assert.ok(await waitFor(() => outs.length > 0));
  assert.match(outs[0].text, /echo: hi/);
  assert.ok(await waitFor(() => channel.outbox.size === 0), 'outbound should be ACKed (cleared from un-acked)');
});

test('bridge: reconnects, re-authenticates, replays un-ACKed', async (t) => {
  const home = tmpHome();
  const secret = 'fixed-secret-123';
  let channel = new MockChannel(home, { autoReply: false, secret });
  await channel.start();
  const bridge = new NanoclawBridge(channel.socketPath, { workspace: 'ws1', agent: 'Andy', secretProvider: () => readBridgeSecret(home), minBackoffMs: 50, maxBackoffMs: 100 });
  const outs = [];
  bridge.on('outbound', (f) => outs.push(f)); // NOTE: not acking → stays un-acked
  bridge.connect();
  t.after(async () => {
    bridge.close();
    await channel.stop();
    rmrf(home);
  });
  assert.ok(await waitFor(() => bridge.isReady()));

  await channel.stop();
  assert.ok(await waitFor(() => !bridge.isReady(), 1000));
  // New channel instance, SAME secret, with an un-acked outbound queued.
  channel = new MockChannel(home, { autoReply: false, secret });
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'late-1', text: 'buffered' });
  await channel.start();

  assert.ok(await waitFor(() => bridge.isReady(), 2000), 'bridge reconnects + re-auths');
  assert.ok(await waitFor(() => outs.some((o) => o.outId === 'late-1'), 2000), 'un-acked replayed');
});

// ===========================================================================
// Adapter — message flow + isolation
// ===========================================================================

test('adapter: happy path — thinking status then reply, then ACK', async (t) => {
  const { adapter, channel, wsClient } = await makeRig(t);
  await adapter._handleMessage(userMsg('what is 2+2?', 'general'));
  assert.ok(await waitFor(() => wsClient.responses('general').length >= 1, 2000));
  assert.ok(wsClient.statuses('general').some((s) => /thinking/.test(s.content)));
  assert.match(wsClient.responses('general')[0].content, /echo: what is 2\+2\?/);
  assert.ok(await waitFor(() => channel.outbox.size === 0, 1500), 'reply ACKed after delivery');
});

test('adapter: agent group missing / wiring missing → actionable errors', async (t) => {
  const r1 = await makeRig(t, { nclState: Object.assign(defaultNclState(), { groups: [{ id: 'other', name: 'Other' }] }) });
  await r1.adapter._handleMessage(userMsg('hi', 'general'));
  assert.ok(await waitFor(() => r1.wsClient.responses('general').length >= 1, 2000));
  assert.match(r1.wsClient.responses('general')[0].content, /Agent Group was not found/i);

  const st = defaultNclState();
  st.wirings = [];
  const r2 = await makeRig(t, { nclState: st });
  await r2.adapter._handleMessage(userMsg('hi', 'general'));
  assert.ok(await waitFor(() => r2.wsClient.responses('general').length >= 1, 2000));
  assert.match(r2.wsClient.responses('general')[0].content, /not wired/i);
});

test('adapter: per-channel session isolation + no cross-delivery', async (t) => {
  const received = [];
  const { adapter, wsClient } = await makeRig(t, {
    channelOpts: {
      onInbound: (f, api) => {
        received.push(f.platformId);
        setTimeout(() => api.outbound(`reply for ${f.text}`), 15);
      },
    },
  });
  await Promise.all([adapter._handleMessage(userMsg('A', 'chan-a')), adapter._handleMessage(userMsg('B', 'chan-b'))]);
  await waitFor(() => wsClient.responses('chan-a').length && wsClient.responses('chan-b').length, 2000);
  assert.ok(received.includes('oa:ws1:chan-a') && received.includes('oa:ws1:chan-b'));
  assert.match(wsClient.responses('chan-a')[0].content, /reply for A/);
  assert.ok(!wsClient.responses('chan-a').some((e) => /reply for B/.test(e.content)));
});

test('adapter: foreign-workspace outbound is ignored AND not ACKed', async (t) => {
  const { channel, wsClient } = await makeRig(t, { channelOpts: { autoReply: false } });
  channel.emit({ op: 'outbound', platformId: 'oa:OTHERWS:general', outId: 'x1', text: 'leak' });
  await sleep(200);
  assert.equal(wsClient.events.length, 0);
  assert.ok(channel.outbox.has('x1'), 'foreign outbound left for its owning bridge (not ACKed)');
});

test('adapter: loop guard — agent-authored inbound not forwarded', async (t) => {
  const { adapter, channel } = await makeRig(t);
  await adapter._handleMessage({ id: 'a1', content: 'I am the agent', sessionId: 'general', senderType: 'agent', senderName: 'Andy' });
  await sleep(150);
  assert.equal(channel.received.length, 0);
});

test('adapter: timeout → TIMEOUT error when no reply', async (t) => {
  const { adapter, wsClient } = await makeRig(t, { channelOpts: { autoReply: false } });
  await adapter._handleMessage(userMsg('silence', 'general'));
  assert.ok(await waitFor(() => wsClient.responses('general').some((e) => /did not reply in time/i.test(e.content)), 2000));
});

test('adapter: redaction — neither token nor handshake secret appears in logs', async (t) => {
  const { adapter, channel, logs } = await makeRig(t);
  await adapter._handleMessage(userMsg('hello', 'general'));
  await sleep(120);
  const joined = logs.join('\n');
  assert.ok(!joined.includes('SECRET-TOKEN-abcdef123456'));
  assert.ok(!joined.includes(channel.secret), 'handshake secret must never be logged');
});

test('adapter: stop() cleans up bridge but spares the shared ncl host', async (t) => {
  const { adapter, ncl } = await makeRig(t);
  assert.ok(adapter._bridge.isConnected());
  adapter.stop();
  await waitFor(() => !adapter._bridge.isConnected(), 1000);
  assert.equal(adapter._statusPoller, null);
  assert.equal(ncl.isListening(), true);
  const ctl = new NclControl(path.join(adapter._home, 'data', 'ncl.sock'));
  assert.equal(await ctl.ping(), true);
});

// ===========================================================================
// Area 2 — ACK, persistent dedup, replay
// ===========================================================================

test('ack: duplicate outbound (replay) is re-ACKed but not re-displayed', async (t) => {
  const { adapter, channel, wsClient } = await makeRig(t, { channelOpts: { autoReply: false } });
  await adapter._handleMessage(userMsg('go', 'general'));
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'dup-1', text: 'once' });
  await waitFor(() => wsClient.responses('general').some((e) => /once/.test(e.content)), 1500);
  const before = channel.acks.length;
  // replay the same outId
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'dup-1', text: 'once' });
  await sleep(200);
  assert.equal(wsClient.responses('general').filter((e) => /once/.test(e.content)).length, 1, 'no re-display');
  assert.ok(channel.acks.length > before, 'replay still ACKed');
});

test('ack: persisted dedup survives a bridge restart (no re-display)', async (t) => {
  // First adapter delivers + persists outId, then "restarts" (new instance,
  // same store dir); the channel replays the same outId → no re-display, re-ACK.
  const home = tmpHome();
  const stateDir = path.join(home, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const ncl = new MockNcl(path.join(home, 'data', 'ncl.sock'), defaultNclState());
  const channel = new MockChannel(home, { autoReply: false });
  await ncl.start();
  await channel.start();

  const baseEnv = {
    NANOCLAW_HOME: home,
    NANOCLAW_AGENT_GROUP: 'ag-1',
    NANOCLAW_STATE_DIR: stateDir,
    NANOCLAW_REPLY_TIMEOUT_MS: '500',
    NANOCLAW_REPLY_SILENCE_MS: '120',
  };
  const mk = () => {
    const a = new NanoClawAdapter({ workspaceId: 'ws1', channelName: 'general', token: 't', agentName: 'Andy', endpoint: 'http://127.0.0.1:1/none', agentEnv: baseEnv });
    a.client = new MockWorkspaceClient();
    a._log = () => {};
    return a;
  };

  const a1 = mk();
  await a1._startBridge();
  await waitFor(() => a1._bridge.isReady(), 2000);
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'persist-1', text: 'hello once' });
  await waitFor(() => a1.client.responses('general').length === 1, 1500);
  await waitFor(() => channel.acks.some((k) => k.outId === 'persist-1'), 1500);
  a1.stop();
  await sleep(50);

  // Restart: new adapter, same store dir; channel still holds nothing un-acked,
  // but simulate a re-delivery of the same outId on reconnect.
  const a2 = mk();
  await a2._startBridge();
  await waitFor(() => a2._bridge.isReady(), 2000);
  channel.acks.length = 0;
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'persist-1', text: 'hello once' });
  await sleep(250);
  assert.equal(a2.client.responses('general').length, 0, 'restarted bridge must not re-display a processed outId');
  assert.ok(channel.acks.some((k) => k.outId === 'persist-1'), 'restarted bridge re-ACKs the replay');

  a2.stop();
  await channel.stop();
  await ncl.stop();
  rmrf(home);
});

test('ack: unknown / out-of-order / duplicate ACKs never crash the channel', async (t) => {
  const home = tmpHome();
  const channel = new MockChannel(home, { autoReply: false });
  await channel.start();
  t.after(async () => {
    await channel.stop();
    rmrf(home);
  });
  const bridge = new NanoclawBridge(channel.socketPath, { secretProvider: () => readBridgeSecret(home) });
  bridge.connect();
  assert.ok(await waitFor(() => bridge.isReady()));
  bridge.sendAck('never-existed', 'oa:ws1:x'); // unknown
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'o9', text: 'x' });
  bridge.sendAck('o9', 'oa:ws1:general');
  bridge.sendAck('o9', 'oa:ws1:general'); // duplicate
  bridge.sendAck('o9', 'oa:wrong:ctx'); // wrong platform context
  await sleep(150);
  assert.equal(channel.outbox.has('o9'), false);
  bridge.close();
});

test('store: bounded by maxEntries (oldest evicted) and persists across reload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncstore-'));
  try {
    const f = path.join(dir, 's.json');
    const now = Date.now();
    const s1 = new DeliveryStore(f, { maxEntries: 2 }).load();
    s1.add('a', now);
    s1.add('b', now);
    s1.add('c', now); // evicts 'a'
    assert.equal(s1.has('a'), false);
    assert.equal(s1.has('c'), true);
    // reload from disk
    const s2 = new DeliveryStore(f, { maxEntries: 2 }).load();
    assert.equal(s2.has('c'), true);
    // persisted file contains only outIds + timestamps (no message bodies)
    const raw = fs.readFileSync(f, 'utf-8');
    assert.ok(!/hello|prompt|token|message/i.test(raw));
  } finally {
    rmrf(dir);
  }
});

// ===========================================================================
// Area 3 — detach (stop = stop waiting, NOT cancel)
// ===========================================================================

test('detach: Stop drops the old session (not "Cancelled"), bumps the thread epoch, spares host', async (t) => {
  const { adapter, channel, ncl, wsClient } = await makeRig(t, {
    channelOpts: { onInbound: (f, api) => setTimeout(() => api.outbound('late reply after stop'), 200) },
  });
  const p = adapter._handleMessage(userMsg('long task', 'general'));
  await sleep(40);
  assert.equal(adapter._threadIdFor('general'), 'oa-0', 'epoch 0 before stop');
  await adapter._onControlAction('stop', {});
  await p;

  const statuses = wsClient.statuses('general').map((s) => s.content).join(' | ');
  assert.match(statuses, /stopped/i);
  assert.ok(!/cancel/i.test(statuses), 'must NOT say cancelled');
  assert.ok(adapter._detachedThreads.has(adapter._detachKey('oa:ws1:general', 'oa-0')), 'old thread recorded as detached');
  assert.equal(adapter._threadIdFor('general'), 'oa-1', 'epoch bumped to a fresh thread');
  // The late reply (authoritative old threadId oa-0) is suppressed but ACKed.
  await waitFor(() => channel.acks.length > 0, 1500);
  assert.ok(!wsClient.responses('general').some((e) => /late reply/.test(e.content)), 'old-session reply dropped');
  assert.equal(ncl.isListening(), true, 'shared host untouched');
});

test('detach: a new message immediately starts a fresh session; old reply suppressed', async (t) => {
  const { adapter, channel, wsClient } = await makeRig(t, {
    channelOpts: { onInbound: (f, api) => setTimeout(() => api.outbound(`reply: ${f.text}`), 80) },
  });
  const p = adapter._handleMessage(userMsg('first', 'general'));
  await sleep(30);
  await adapter._onControlAction('stop', {});
  await p;
  // No blocking: a new message works right away on the new thread (oa-1).
  await adapter._handleMessage(userMsg('second', 'general', 'm-second'));
  assert.ok(channel.received.some((r) => r.text === 'first' && r.threadId === 'oa-0'));
  assert.ok(channel.received.some((r) => r.text === 'second' && r.threadId === 'oa-1'));
  assert.ok(await waitFor(() => wsClient.responses('general').some((e) => /reply: second/.test(e.content)), 2000));
  assert.ok(!wsClient.responses('general').some((e) => /reply: first/.test(e.content)), 'old reply never shown');
});

// REQUIRED: old container stopped, but the old outbound arrives AFTER the new
// message was sent — it must never appear in the new turn.
test('detach: an old reply arriving AFTER the new message is never shown in the new turn', async (t) => {
  const { adapter, channel, wsClient } = await makeRig(t, { channelOpts: { autoReply: false } });
  const p = adapter._handleMessage(userMsg('first', 'general'));
  await sleep(30);
  const firstThread = channel.received.find((r) => r.text === 'first').threadId; // oa-0
  await adapter._onControlAction('stop', {}); // container "stopped"; epoch → oa-1
  await p;
  await adapter._handleMessage(userMsg('second', 'general', 'm-second'));
  const secondThread = channel.received.find((r) => r.text === 'second').threadId; // oa-1
  assert.notEqual(firstThread, secondThread);

  // The OLD session's reply (authoritative old thread_id) arrives now — AFTER the
  // new message — and is replayed; the NEW session also replies.
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'old-1', threadId: firstThread, text: 'OLD reply' });
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'old-1', threadId: firstThread, text: 'OLD reply' });
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'new-1', threadId: secondThread, text: 'NEW reply' });
  await sleep(200);
  assert.ok(!wsClient.responses('general').some((e) => /OLD reply/.test(e.content)), 'old reply (old thread) never enters the new turn');
  assert.ok(wsClient.responses('general').some((e) => /NEW reply/.test(e.content)), 'new reply (new thread) shown');
});

test('detach: detached thread stays suppressed across a bridge reconnect', async (t) => {
  const { adapter, channel, wsClient } = await makeRig(t, { channelOpts: { autoReply: false } });
  const p = adapter._handleMessage(userMsg('x', 'general'));
  await sleep(30);
  await adapter._onControlAction('stop', {});
  await p;
  assert.ok(adapter._detachedThreads.has(adapter._detachKey('oa:ws1:general', 'oa-0')));
  await channel.stop();
  await waitFor(() => !adapter._bridge.isReady(), 1000);
  await channel.start();
  await waitFor(() => adapter._bridge.isReady(), 2000);
  // old session reply (old thread oa-0) arrives after reconnect → still suppressed
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'd1', threadId: 'oa-0', text: 'belated' });
  await sleep(200);
  assert.ok(!wsClient.responses('general').some((e) => /belated/.test(e.content)));
  assert.ok(adapter._detachedThreads.has(adapter._detachKey('oa:ws1:general', 'oa-0')), 'detach persists across reconnect');
});

test('detach: detaching one channel does not suppress another channel using the same epoch thread', async (t) => {
  const { adapter, wsClient } = await makeRig(t, {
    channelOpts: { onInbound: (f, api) => setTimeout(() => api.outbound(`reply: ${f.text}`), 40) },
  });
  // start a turn on chan-a, stop it (detaches oa:ws1:chan-a / oa-0)
  const pa = adapter._handleMessage(userMsg('a1', 'chan-a'));
  await sleep(20);
  await adapter._onControlAction('stop', { channel: 'chan-a' });
  await pa;
  // chan-b also uses threadId oa-0 but a DIFFERENT platformId → must NOT be suppressed
  await adapter._handleMessage(userMsg('b1', 'chan-b'));
  assert.ok(await waitFor(() => wsClient.responses('chan-b').some((e) => /reply: b1/.test(e.content)), 2000), 'chan-b unaffected');
});

test('abnormal exit mid-turn → reconnecting status, no crash', async (t) => {
  const { adapter, channel, wsClient } = await makeRig(t, {
    channelOpts: { onInbound: (f, api) => setTimeout(() => api.outbound('too late'), 1000) },
  });
  const p = adapter._handleMessage(userMsg('crash', 'general'));
  await sleep(60);
  await channel.stop();
  await p;
  assert.ok(wsClient.statuses('general').some((s) => /reconnecting/i.test(s.content)));
});

// ===========================================================================
// Area 4 — commit-gated, rollback-safe channel installer
// ===========================================================================

const VC = channelInstall.VERIFIED.commit;
const OTHER_COMMIT = '0'.repeat(40);

function fakeNanoclawCheckout() {
  const home = tmpHome();
  fs.writeFileSync(path.join(home, 'package.json'), JSON.stringify({ name: 'nanoclaw', version: '2.1.19' }));
  fs.mkdirSync(path.join(home, 'src', 'channels'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'src', 'channels', 'adapter.ts'),
    'export interface ChannelAdapter { onInbound(): void; deliver(): Promise<string|undefined>; }\n',
  );
  fs.writeFileSync(path.join(home, 'src', 'channels', 'channel-registry.ts'), 'export function registerChannelAdapter(){}\n');
  fs.writeFileSync(path.join(home, 'src', 'config.ts'), 'export const DATA_DIR = "/d";\n');
  fs.writeFileSync(path.join(home, 'src', 'channels', 'index.ts'), "import './cli.js';\n");
  return home;
}
function unmodified(home) {
  return (
    !fs.existsSync(channelInstall.channelDestPath(home)) &&
    !fs.readFileSync(channelInstall.barrelPath(home), 'utf-8').includes('openagents.js')
  );
}

test('install: exact verified commit installs + is idempotent', (t) => {
  const home = fakeNanoclawCheckout();
  t.after(() => rmrf(home));
  const r1 = channelInstall.installChannel(home, { commitOverride: VC });
  assert.equal(r1.ok, true);
  assert.equal(r1.code, 'verified');
  assert.equal(r1.changed, true);
  assert.ok(fs.readFileSync(channelInstall.barrelPath(home), 'utf-8').includes("import './openagents.js';"));
  assert.equal(channelInstall.installChannel(home, { commitOverride: VC }).changed, false, 'idempotent');
});

test('install: same version but different commit → commit-mismatch, no modify', (t) => {
  const home = fakeNanoclawCheckout();
  t.after(() => rmrf(home));
  const r = channelInstall.installChannel(home, { commitOverride: OTHER_COMMIT });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'commit-mismatch');
  assert.ok(unmodified(home), 'must not modify the checkout');
});

test('install: unknown commit (non-git checkout) → unknown, no modify', (t) => {
  const home = fakeNanoclawCheckout();
  t.after(() => rmrf(home));
  const r = channelInstall.installChannel(home); // not a git repo → commit null
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unknown');
  assert.ok(unmodified(home));
});

test('install: force is OFF by default and requires explicit force:true', (t) => {
  const home = fakeNanoclawCheckout();
  t.after(() => rmrf(home));
  // unverified commit, no force → refused, untouched
  assert.equal(channelInstall.installChannel(home, { commitOverride: OTHER_COMMIT }).ok, false);
  assert.ok(unmodified(home));
  // explicit admin force → installs (code 'forced')
  const r = channelInstall.installChannel(home, { commitOverride: OTHER_COMMIT, force: true, logger: () => {} });
  assert.equal(r.ok, true);
  assert.equal(r.code, 'forced');
  assert.equal(r.forced, true);
  assert.ok(fs.existsSync(channelInstall.channelDestPath(home)));
});

test('install: structural gate is HARD — missing ChannelAdapter refuses even with force', (t) => {
  const home = fakeNanoclawCheckout();
  t.after(() => rmrf(home));
  fs.writeFileSync(path.join(home, 'src', 'channels', 'adapter.ts'), 'export interface Something {}\n');
  const r = channelInstall.installChannel(home, { commitOverride: VC, force: true, logger: () => {} });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'incompatible');
  assert.ok(unmodified(home));
});

test('install: refuses to overwrite a user-owned openagents.ts', (t) => {
  const home = fakeNanoclawCheckout();
  t.after(() => rmrf(home));
  fs.writeFileSync(channelInstall.channelDestPath(home), '// my own channel, do not touch\n');
  const r = channelInstall.installChannel(home, { commitOverride: VC });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'foreign-file');
  assert.match(fs.readFileSync(channelInstall.channelDestPath(home), 'utf-8'), /my own channel/);
});

test('install: uninstall removes only OpenAgents-injected file + barrel block', (t) => {
  const home = fakeNanoclawCheckout();
  t.after(() => rmrf(home));
  channelInstall.installChannel(home, { commitOverride: VC });
  const u = channelInstall.uninstallChannel(home);
  assert.equal(u.changed, true);
  const after = fs.readFileSync(channelInstall.barrelPath(home), 'utf-8');
  assert.ok(after.includes("import './cli.js';"), 'user import preserved');
  assert.ok(!after.includes('openagents.js'), 'our import removed');
  assert.equal(fs.existsSync(channelInstall.channelDestPath(home)), false, 'our file removed');
});

test('install: VERIFIED provenance — remote, commit, tag status, fingerprint', () => {
  assert.equal(channelInstall.VERIFIED.remote, 'https://github.com/nanocoai/nanoclaw');
  assert.match(channelInstall.VERIFIED.commit, /^[0-9a-f]{40}$/);
  assert.equal(channelInstall.VERIFIED.tag, null, 'unconfirmed-release main commit');
  assert.match(channelInstall.VERIFIED.interfaceFingerprint, /^[0-9a-f]{16}$/);
});

// ===========================================================================
// Area 1 — channel-side PERSISTENT outbox (survives channel/host restart)
// ===========================================================================

test('outbox: un-ACKed reply persists across a channel/host restart and replays', async (t) => {
  const home = tmpHome();
  let channel = new MockChannel(home, { autoReply: false });
  await channel.start();
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'survive-1', text: 'persisted reply body' });
  assert.ok(channel.outbox.has('survive-1'));
  assert.ok(fs.existsSync(channel._recFile('survive-1')), 'written to disk');
  await channel.stop();

  // "restart": brand-new channel instance on the same home reloads from disk.
  channel = new MockChannel(home, { autoReply: false });
  await channel.start();
  assert.ok(channel.outbox.has('survive-1'), 'reloaded un-ACKed record after restart');

  const got = [];
  const bridge = new NanoclawBridge(channel.socketPath, { secretProvider: () => readBridgeSecret(home) });
  bridge.on('outbound', (f) => got.push(f));
  bridge.connect();
  t.after(async () => {
    bridge.close();
    await channel.stop();
    rmrf(home);
  });
  assert.ok(await waitFor(() => got.some((f) => f.outId === 'survive-1'), 2000), 'replayed on reconnect');
  // ACK clears it from disk permanently.
  bridge.sendAck('survive-1', 'oa:ws1:general');
  assert.ok(await waitFor(() => !channel.outbox.has('survive-1'), 1500));
  assert.equal(fs.existsSync(channel._recFile('survive-1')), false, 'record file deleted on ACK');
});

test('outbox: an ACKed reply does NOT replay after restart', async (t) => {
  const home = tmpHome();
  let channel = new MockChannel(home, { autoReply: false });
  await channel.start();
  const bridge = new NanoclawBridge(channel.socketPath, { secretProvider: () => readBridgeSecret(home) });
  bridge.on('outbound', (f) => bridge.sendAck(f.outId, f.platformId));
  bridge.connect();
  assert.ok(await waitFor(() => bridge.isReady()));
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'acked-1', text: 'will be acked' });
  assert.ok(await waitFor(() => !channel.outbox.has('acked-1'), 1500));
  bridge.close();
  await channel.stop();

  channel = new MockChannel(home, { autoReply: false });
  await channel.start();
  t.after(async () => {
    await channel.stop();
    rmrf(home);
  });
  assert.equal(channel.outbox.has('acked-1'), false, 'ACKed record gone after restart');
});

test('outbox: overflow drops the oldest with a dropped/overflow signal', async (t) => {
  const home = tmpHome();
  const channel = new MockChannel(home, { autoReply: false, maxOutbox: 2 });
  await channel.start();
  t.after(async () => {
    await channel.stop();
    rmrf(home);
  });
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'o1', text: 'a' });
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'o2', text: 'b' });
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'o3', text: 'c' }); // evicts o1
  assert.ok(channel.dropped.some((d) => d.outId === 'o1' && d.reason === 'overflow'));
  assert.ok(channel.outbox.size <= 2);
  assert.equal(channel.outbox.has('o1'), false);
});

test('outbox: expired record is dropped with a dropped/expired signal', async (t) => {
  const home = tmpHome();
  const channel = new MockChannel(home, { autoReply: false, ttlMs: 40 });
  await channel.start();
  t.after(async () => {
    await channel.stop();
    rmrf(home);
  });
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'old-1', text: 'x' });
  await sleep(80);
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'new-1', text: 'y' }); // triggers prune
  assert.ok(channel.dropped.some((d) => d.outId === 'old-1' && d.reason === 'expired'));
  assert.equal(channel.outbox.has('old-1'), false);
});

test('outbox: record file is 0600, dir 0700, has body but no secret/token', async (t) => {
  const home = tmpHome();
  const channel = new MockChannel(home, { autoReply: false, secret: 'THE-SECRET-VALUE' });
  await channel.start();
  t.after(async () => {
    await channel.stop();
    rmrf(home);
  });
  channel.emit({ op: 'outbound', platformId: 'oa:ws1:general', outId: 'p1', text: 'a reply body' });
  const f = channel._recFile('p1');
  const raw = fs.readFileSync(f, 'utf-8');
  assert.match(raw, /a reply body/, 'outbox holds the reply body (local sensitive cache)');
  assert.ok(!raw.includes('THE-SECRET-VALUE'), 'never the handshake secret');
  assert.ok(!/token|password|api[_-]?key/i.test(raw), 'no credentials');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    assert.equal(fs.statSync(channel.outboxDir).mode & 0o777, 0o700);
  }
});

test('outbox: adapter surfaces a dropped (overflow/expired/corrupt) as a status', async (t) => {
  const { adapter, wsClient } = await makeRig(t);
  adapter._onDropped({ platformId: 'oa:ws1:general', outId: 'x', reason: 'overflow' });
  adapter._onDropped({ platformId: 'oa:ws1:general', outId: 'y', reason: 'expired' });
  // corrupt has no platformId → surfaced on the default channel
  adapter._onDropped({ platformId: null, reason: 'corrupt', count: 2 });
  await sleep(50);
  const s = wsClient.statuses('general').map((e) => e.content).join(' | ');
  assert.match(s, /outbox is full|not be recoverable/i);
  assert.match(s, /expired|not be recoverable/i);
  assert.match(s, /corrupt|quarantined|not be recoverable/i);
});

// ===========================================================================
// Task 2 — outbox crash safety: interrupted write + corrupt-record recovery
// ===========================================================================

test('outbox: an interrupted write (leftover .tmp) is ignored, never loaded as partial', async (t) => {
  const home = tmpHome();
  const channel = new MockChannel(home, { autoReply: false });
  channel.writeSecret(); // create outbox dir without starting the server
  // a partial temp file from a crash mid-persist
  fs.writeFileSync(path.join(channel.outboxDir, 'deadbeef.json.tmp'), '{"outId":"half');
  await channel.start();
  t.after(async () => {
    await channel.stop();
    rmrf(home);
  });
  assert.equal(channel.outbox.size, 0, 'partial .tmp is not loaded');
  assert.ok(fs.existsSync(path.join(channel.outboxDir, 'deadbeef.json.tmp')), 'left in place, not loaded');
});

test('outbox: a corrupt record is quarantined (not deleted) + delivery_corrupt is surfaced', async (t) => {
  const home = tmpHome();
  let channel = new MockChannel(home, { autoReply: false });
  channel.writeSecret();
  // one valid record + one corrupt record on disk
  const good = { outId: 'good-1', platformId: 'oa:ws1:general', threadId: null, turnId: 't', sessionKey: 'oa:ws1:general', kind: 'chat', text: 'survives', ts: Date.now() };
  fs.writeFileSync(channel._recFile('good-1'), JSON.stringify(good), { mode: 0o600 });
  fs.writeFileSync(path.join(channel.outboxDir, 'corruptrec.json'), '{ not valid json ]', { mode: 0o600 });

  channel = new MockChannel(home, { autoReply: false }); // restart → _load
  await channel.start();
  // valid record recovered; corrupt one quarantined (moved aside, not deleted)
  assert.ok(channel.outbox.has('good-1'), 'valid record still loads (recovery)');
  assert.equal(fs.existsSync(path.join(channel.outboxDir, 'corruptrec.json')), false, 'corrupt file moved');
  assert.ok(fs.readdirSync(path.join(channel.outboxDir, 'corrupt')).length >= 1, 'quarantined under corrupt/');
  assert.ok(channel.corruptCount >= 1);

  // a connector handshake surfaces a delivery_corrupt (dropped/corrupt) signal
  const dropped = [];
  const bridge = new NanoclawBridge(channel.socketPath, { secretProvider: () => readBridgeSecret(home) });
  bridge.on('dropped', (f) => dropped.push(f));
  bridge.connect();
  t.after(async () => {
    bridge.close();
    await channel.stop();
    rmrf(home);
  });
  assert.ok(await waitFor(() => dropped.some((f) => f.reason === 'corrupt'), 2000), 'delivery_corrupt surfaced');
});

// ===========================================================================
// Boundary — single authenticated connector per host
// ===========================================================================

test('single-connection: a second connector is rejected; new takes over only after old drops', async (t) => {
  const home = tmpHome();
  const channel = new MockChannel(home);
  await channel.start();
  const mk = () => new NanoclawBridge(channel.socketPath, { secretProvider: () => readBridgeSecret(home), minBackoffMs: 10000 });
  const b1 = mk();
  b1.connect();
  assert.ok(await waitFor(() => b1.isReady()), 'first connector ready');

  const b2 = mk();
  let b2Rejected = false;
  b2.on('auth-failed', (code) => {
    if (code === 'single_connection') b2Rejected = true;
  });
  b2.connect();
  t.after(async () => {
    b1.close();
    b2.close();
    await channel.stop();
    rmrf(home);
  });
  assert.ok(await waitFor(() => b2Rejected, 1500), 'second connector rejected (single_connection)');
  assert.equal(b2.isReady(), false);
  assert.ok(b1.isReady(), 'first connector still attached');
  assert.ok(channel.rejected.includes('single_connection'));

  // After the first drops, a fresh connector can take over.
  b1.close();
  await waitFor(() => channel.authedClient === null, 1500);
  const b3 = mk();
  b3.connect();
  t.after(() => b3.close());
  assert.ok(await waitFor(() => b3.isReady(), 2000), 'new connector takes over after old drops');
});
