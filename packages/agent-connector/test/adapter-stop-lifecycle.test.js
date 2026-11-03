'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const http = require('node:http');
const BaseAdapter = require('../src/adapters/base');
const CodexAdapter = require('../src/adapters/codex');
const LlmDirectAdapter = require('../src/adapters/llm-direct');
const { Daemon } = require('../src/daemon');
const opts = { workspaceId: 'stop-test', agentName: 'stop-test', channelName: 'a', token: 'test', agentEnv: {}, endpoint: 'http://127.0.0.1:1', logSink() {} };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function adapter(Type = BaseAdapter) {
  const a = new Type(opts);
  a._prefetchPinnedContext = a._autoTitleChannel = async () => {};
  a.client.getTodos = async () => ({ todos: [] });
  a.client.sendMessage = async () => {};
  a._persistCursor = () => {};
  return a;
}
const msg = content => ({ content, sessionId: 'a' });
const tick = () => new Promise(r => setImmediate(r));
const delay = ms => new Promise(r => setTimeout(r, ms));
for (const stage of ['prefetch', 'handler', 'shifted']) {
  it(`terminal stop invalidates ${stage} and queued work`, { timeout: 4000 }, async () => {
    const a = adapter(), entered = deferred(), release = deferred(), handled = [];
    let prefetches = 0;
    a._prefetchPinnedContext = async () => {
      prefetches++;
      if (stage === 'prefetch' || (stage === 'shifted' && prefetches === 2)) { entered.resolve(); await release.promise; }
    };
    a._handleMessage = async m => {
      if (stage === 'handler') { entered.resolve(); await release.promise; }
      if (a._stoppedBeforeStart('a')) return;
      handled.push(m.content);
    };
    const worker = a._channelWorker('a', msg('first'));
    await a._dispatchMessage(msg('queued'));
    await entered.promise;
    a.stop(); a.stop();
    await a._dispatchMessage(msg('after terminal stop'));
    release.resolve(); await worker;
    assert.deepEqual(handled, stage === 'shifted' ? ['first'] : []);
    assert.equal(a._channelBusy.size, 0);
    assert.deepEqual(a._channelQueues, {});
  });
}
it('terminal stop kills an owned real child and descendant exactly once', { timeout: 6000 }, async t => {
  const a = adapter(CodexAdapter);
  const proc = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000);`], { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill(); } });
  const [data] = await once(proc.stdout, 'data');
  const childPid = Number(String(data).trim()), exited = once(proc, 'exit');
  let kills = 0;
  const kill = a._stopProcess.bind(a);
  a._stopProcess = p => { kills++; return kill(p); };
  a._channelProcesses.a = proc;
  await a.stop(); await a.stop();
  await Promise.race([exited, delay(600)]);
  assert.notEqual(proc.signalCode, null, 'active child survived terminal stop');
  assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
  assert.equal(kills, 1);
});
it('late child registration is killed without a worker generation', { timeout: 4000 }, async t => {
  const a = adapter(CodexAdapter); a.stop();
  const proc = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: process.platform !== 'win32', stdio: 'ignore' });
  t.after(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill(); } });
  await once(proc, 'spawn');
  const exited = once(proc, 'exit'); a._channelProcesses.a = proc;
  await Promise.race([exited, delay(600)]);
  assert.notEqual(proc.signalCode, null);
});
for (const Type of [CodexAdapter, LlmDirectAdapter]) {
  it(`${Type.name}: terminal stop aborts real HTTP and prevents future requests`, { timeout: 4000 }, async t => {
    const received = deferred(), closed = deferred(); let requests = 0;
    const server = http.createServer((req, res) => {
      requests++; res.on('close', closed.resolve); req.resume();
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'); received.resolve();
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const a = adapter(Type);
    a._baseUrl = a._directBaseUrl = `http://127.0.0.1:${server.address().port}`;
    a._buildSystemContext = a._buildSystemPrompt = () => '';
    const pending = a._callCompletionApi('hello', 'a').then(() => 'resolved', () => 'cancelled');
    await received.promise; a.stop(); a.stop();
    assert.equal(await Promise.race([pending, delay(600).then(() => 'still running')]), 'cancelled');
    await closed.promise;
    await Promise.race([a._callCompletionApi('late', 'a').catch(() => {}), delay(100)]);
    assert.equal(requests, 1);
  });
}
it('terminal stop mutes all replies including a late stop notice', async () => {
  const a = adapter(), posted = []; a.client.sendMessage = async (...args) => posted.push(args);
  // Never write a baseline reply to the real outbox.
  a._replyOutbox = () => ({ enqueue: async e => posted.push(e) });
  a.stop();
  await a.sendStatus('new-channel', 'late'); await a.sendError('a', 'late');
  await a.sendThinking('a', 'late'); await a.sendResponse('a', 'late');
  await a._announceUserStop('a', 'stopped'); assert.deepEqual(posted, []);
});
it('channel Stop admits a new turn but terminal stop never does', async () => {
  const a = adapter(), entered = deferred(), release = deferred(), handled = [];
  a._handleMessage = async m => { handled.push(m.content); if (m.content === 'first') { entered.resolve(); await release.promise; } };
  const worker = a._channelWorker('a', msg('first')); await entered.promise;
  await a._handleUserStop('a'); await a._dispatchMessage(msg('second')); release.resolve(); await worker;
  a.stop(); await a._dispatchMessage(msg('third')); await tick();
  assert.deepEqual(handled, ['first', 'second']);
});
it('stop during join cannot start loops or revive run()', async () => {
  const a = adapter(), entered = deferred(), release = deferred(), calls = [];
  a._joinWorkspace = async () => { entered.resolve(); await release.promise; };
  a.client.disconnect = async () => {};
  a.client.getAgents = async () => { calls.push('skills'); return []; };
  a._skipExistingControlEvents = a._skipExistingEvents = async () => {};
  a._heartbeat = async () => { calls.push('heartbeat'); }; a._flushResponses = async () => {};
  a._pollLoop = async () => { calls.push('poll'); }; a._controlPollerLoop = async () => { calls.push('control'); };
  const running = a.run(); await entered.promise; a.stop(); release.resolve(); await running; await a.run();
  assert.deepEqual(calls, []);
});
it('late poll results cannot dispatch messages or control actions', async () => {
  const a = adapter(), messages = deferred(), controls = deferred(), calls = [];
  a.client.pollPending = () => messages.promise; a.client.pollControl = () => controls.promise;
  a._sleep = async () => {}; a._dispatchMessage = async () => calls.push('message'); a._onControlAction = async () => calls.push('control');
  a._running = true; const polling = a._pollLoop(), control = a._pollControl(); a.stop();
  messages.resolve({ messages: [msg('late')], cursor: null }); controls.resolve([{ id: 'late', payload: { action: 'restart' } }]);
  await Promise.all([polling, control]); assert.deepEqual(calls, []);
});
for (const method of ['stopAgent', '_killAgent']) {
  it(`daemon ${method} reaches an in-process adapter with no info.proc`, async () => {
    const a = adapter(), entered = deferred(), release = deferred(), handled = [];
    a._prefetchPinnedContext = async () => { entered.resolve(); await release.promise; };
    a._handleMessage = async m => handled.push(m.content);
    const worker = a._channelWorker('a', msg('late')); await entered.promise;
    const d = Object.create(Daemon.prototype);
    Object.assign(d, { _adapters: { test: a }, _processes: { test: { proc: null, state: 'running' } }, _stoppedAgents: new Set(), _writeStatus() {}, _log() {} });
    const stopped = d[method]('test', 100); delete d._adapters.test; release.resolve();
    await Promise.all([stopped, worker]); assert.deepEqual(handled, []); assert.equal(a.wasStopRequested(), true);
  });
}

it('OpenWorker stop during port allocation prevents the shared server spawn', async () => {
  const a = adapter(require('../src/adapters/openworker'));
  const entered = deferred(), release = deferred();
  a._findServerBinary = () => process.execPath;
  a._provisionStateDir = () => require('node:os').tmpdir();
  a._freePort = async () => { entered.resolve(); return release.promise; };
  let spawnPreparations = 0;
  a._serverEnv = () => { spawnPreparations++; return {}; };
  const starting = a._ensureServer(require('node:os').tmpdir());
  await entered.promise;
  await a.stop(); release.resolve(1);
  await assert.rejects(starting, /stopped/);
  assert.equal(spawnPreparations, 0);
  assert.equal(a._server, null);
});

it('OpenWorker terminal stop interrupts sockets and kills its owned server', { timeout: 5000 }, async t => {
  const a = adapter(require('../src/adapters/openworker'));
  const proc = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: process.platform !== 'win32', stdio: 'ignore' });
  t.after(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill(); } });
  await once(proc, 'spawn'); const exited = once(proc, 'exit');
  a._server = { proc };
  const sent = [], closed = [];
  a._sleep = async () => {};
  a._channelSockets.a = { send: m => sent.push(JSON.parse(m)), close: () => closed.push('a') };
  await a.stop(); await a.stop(); await exited;
  assert.deepEqual(sent, [{ type: 'interrupt' }]);
  assert.deepEqual(closed, ['a']);
  assert.equal(a._server, null);
  assert.deepEqual(a._channelSockets, {});
});

it('NanoClaw terminal stop settles turns and closes only its bridge', async () => {
  const a = adapter(require('../src/adapters/nanoclaw'));
  const calls = [];
  a._bridge = { close: () => calls.push('bridge') };
  a._pending.set('p', { settle: result => calls.push(result) });
  a._control = { stop: () => assert.fail('shared host must not stop') };
  await a.stop(); await a.stop();
  assert.deepEqual(calls, [{ stopped: true }, 'bridge']);
  assert.equal(a._pending.size, 0);
  assert.equal(a._statusPoller, null);
});

it('DeepSeek terminal stop releases bootstrap waiters and kills shared bootstrap', async () => {
  const a = adapter(require('../src/adapters/deepseek'));
  const started = deferred();
  a._ensureBootstrap = () => { started.resolve(); return new Promise(() => {}); };
  a._busyChannels.add('a');
  const waiting = a._awaitBootstrap('a'); await started.promise;
  const proc = new (require('node:events'))(); proc.pid = 99999999;
  a._channelProcesses['\u0000bootstrap'] = proc;
  const killed = []; a._stopProcess = async p => { killed.push(p); return true; };
  await a.stop(); await a.stop();
  assert.equal(await waiting, false);
  assert.deepEqual(killed, [proc]);
  assert.equal(a._cancelWaiters.size, 0);
});

it('terminal stop cannot be followed by a synthetic continuation from the old turn', async () => {
  const a = adapter(), entered = deferred(), release = deferred(), handled = [];
  a._handleMessage = async m => {
    handled.push(m.content); entered.resolve(); await release.promise;
    a._channelQueues.a = [msg('synthetic continuation')];
  };
  const worker = a._channelWorker('a', msg('first')); await entered.promise;
  await a.stop(); release.resolve(); await worker;
  assert.deepEqual(handled, ['first']); assert.deepEqual(a._channelQueues, {});
});

it('terminal stop cancels channels concurrently and returns the same teardown promise', async () => {
  const a = adapter(), release = deferred(), cancelled = [];
  a._channelBusy.add('a'); a._channelBusy.add('b');
  a._stopChannelWork = async channel => { cancelled.push(channel); await release.promise; return 'stopped'; };
  const stopping = a.stop(), generation = a._stopGeneration;
  assert.equal(a.stop(), stopping);
  assert.equal(a._stopGeneration, generation);
  assert.deepEqual(cancelled, ['a', 'b']);
  release.resolve(); await stopping;
});

it('terminal stop terminates an auxiliary child outside the channel registry', { timeout: 4000 }, async t => {
  const a = adapter(require('../src/adapters/hermes'));
  const proc = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: process.platform !== 'win32', stdio: 'ignore' });
  t.after(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill(); } });
  await once(proc, 'spawn'); const closed = once(proc, 'close');
  a._trackAuxiliaryProcess(proc);
  await a.stop(); await closed;
  assert.equal(a._auxiliaryProcesses.size, 0);
  await assert.rejects(a._hermesVersionText(), /stopped/);
});

it('NanoClaw cannot inject after stop while waiting for bridge readiness', async () => {
  const a = adapter(require('../src/adapters/nanoclaw')), entered = deferred(), release = deferred();
  let sent = 0;
  a._bridge = { isReady: () => false, sendInbound: () => { sent++; }, close() {} };
  a._waitReady = async () => { entered.resolve(); return release.promise; };
  const injecting = a._inject('p', 'a', 'm', 'turn', 'thread', 'hello');
  await entered.promise; await a.stop(); release.resolve(true);
  assert.equal(await injecting, false); assert.equal(sent, 0);
});

it('Claude never writes another prompt to a persistent child after terminal stop', async () => {
  const a = adapter(require('../src/adapters/claude'));
  const checked = deferred(), release = deferred();
  let writes = 0;
  const pp = { proc: { stdin: { write: () => { writes++; } } } };
  // The caller's async preparation check resolved false just before stop.
  const pending = (async () => {
    checked.resolve(); await release.promise;
    return a._sendToPersistentProc(pp, 'late prompt');
  })();
  await checked.promise; await a.stop(); release.resolve();
  assert.deepEqual(await pending, { exited: true });
  assert.equal(writes, 0);
});

for (const failure of ['return failed', 'throw', 'live child']) {
  it(`terminal cancellation ${failure} is a failed daemon stop, not success`, { timeout: 4000 }, async t => {
    const a = adapter(CodexAdapter);
    a._channelBusy.add('a');
    if (failure === 'live child') {
      const proc = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: process.platform !== 'win32', stdio: 'ignore' });
      t.after(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill(); } });
      await once(proc, 'spawn'); a._channelProcesses.a = proc;
      a._stopProcess = async () => {}; // A failed termination that cannot report an exit.
    } else {
      a._stopChannelWork = async () => { if (failure === 'throw') throw new Error('termination refused'); return 'failed'; };
    }
    const posted = []; a.client.sendMessage = async (_w, _c, _t, content) => posted.push(content);
    const d = Object.create(Daemon.prototype);
    Object.assign(d, { _adapters: { test: a }, _processes: { test: { proc: null, state: 'running' } }, _stoppedAgents: new Set(), _writeStatus() {}, _log() {} });
    await assert.rejects(d.stopAgent('test'), /stop|termination/i);
    assert.equal(d._processes.test.state, 'error');
    assert.equal(d._processes.test.errorReason, 'stop_failed');
    assert.equal(a.getExitInfo().reason, 'stop_failed');
    assert.equal((await a.stop()).ok, false);
    assert.equal(posted.length, 1);
    assert.match(posted[0], /stopping failed/i);
  });
}

it('terminal shutdown posts one final interruption while suppressing late model output', async () => {
  const a = adapter(), entered = deferred(), release = deferred(), posted = [];
  a.client.sendMessage = async (_w, _c, _t, content, options) => posted.push({ content, options });
  a._handleMessage = async () => { entered.resolve(); await release.promise; await a.sendThinking('a', 'late thinking'); await a.sendResponse('a', 'late answer'); };
  const worker = a._channelWorker('a', msg('first')); await entered.promise;
  await a.stop(); await a.stop(); release.resolve(); await worker;
  assert.equal(posted.length, 1);
  assert.equal(posted[0].content, 'Task interrupted — daemon restarting. Send another message to continue.');
  assert.notEqual(posted[0].options.messageType, 'status');
  assert.notEqual(posted[0].options.metadata.status_kind, 'completed');
});

it('outbox capability preparation resumed after stop cannot send a final reply', async t => {
  const fs = require('node:fs'), path = require('node:path');
  const a = adapter(), entered = deferred(), release = deferred(), sent = [];
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'stop-outbox-race-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  a._responseOutboxDirectory = dir;
  a.client.supportsMessageDelivery = async () => { entered.resolve(); return release.promise; };
  a.client.sendMessage = async (...args) => sent.push(args);
  const sending = a.sendResponse('a', 'late answer'); await entered.promise;
  await a.stop(); release.resolve(true); await sending;
  assert.deepEqual(sent, []);
  assert.equal(a._replyOutbox().readEntries().length, 1, 'durable reply retained, not silently deleted');
});

it('adapter loop finalization preserves stop_failed despite an explicit user stop', async t => {
  const registry = require('../src/adapters'), original = registry.createAdapter;
  t.after(() => { registry.createAdapter = original; });
  const a = adapter(), entered = deferred(), release = deferred();
  registry.createAdapter = () => a;
  a._channelBusy.add('a');
  a._stopChannelWork = async () => 'failed';
  a.run = async () => { entered.resolve(); await release.promise; await a.stop(); };
  const info = { proc: null, state: 'running' }, d = Object.create(Daemon.prototype);
  Object.assign(d, { config: { configDir: require('node:os').tmpdir() }, _adapters: {}, _processes: { test: info }, _stoppedAgents: new Set(), _buildAgentEnv: () => ({}), _writeStatus() {}, _log() {}, _logAs() {} });
  const loop = d._adapterLoop('test', { type: 'codex', path: require('node:os').tmpdir() }, info, { id: 'w', token: 'test' });
  await entered.promise;
  await assert.rejects(d.stopAgent('test'), /stop failed/i);
  release.resolve(); await loop;
  assert.equal(info.state, 'error');
  assert.equal(info.errorReason, 'stop_failed');
  assert.equal(d._adapters.test, a, 'failed owner must remain reachable');
  let launched = false; d._launchAgent = () => { launched = true; };
  await assert.rejects(d.restartAgent('test'), /stop failed/i);
  assert.equal(launched, false);
});
