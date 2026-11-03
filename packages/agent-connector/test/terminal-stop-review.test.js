'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { Daemon } = require('../src/daemon');
const BaseAdapter = require('../src/adapters/base');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
function daemon(a, info = { proc: null, state: 'running' }) {
  const d = Object.create(Daemon.prototype);
  Object.assign(d, { _adapters: { test: a }, _processes: { test: info }, _stoppedAgents: new Set(), _writeStatus() {}, _log() {}, _logAs() {}, _sleep: async () => {} });
  return d;
}
it('stop waits for the owned adapter loop before releasing its slot', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const release = deferred();
  t.after(() => release.resolve());
  const a = { stop: async () => ({ ok: true }) };
  const d = daemon(a, { proc: null, state: 'running', adapterRun: release.promise });
  let stopped = false;
  const stopping = d.stopAgent('test').then(() => { stopped = true; });
  await tick();
  for (let i = 0; i < 12; i++) { t.mock.timers.tick(500); await tick(); }
  assert.equal(stopped, false, 'elapsed time is not evidence that the old loop disconnected');
  assert.equal(d._adapters.test, a);
  release.resolve(); await stopping;
  assert.equal(d._adapters.test, undefined);
});
it('reload cannot force-release an owner whose terminal cancellation failed', async () => {
  const a = { stop: async () => ({ ok: false, message: 'Agent stop failed: termination refused' }) };
  const d = daemon(a);
  await assert.rejects(d._ensureAdapterCleared('test'), /stop failed/);
  assert.equal(d._adapters.test, a);
  assert.equal(d._processes.test.errorReason, 'stop_failed');
});
it('late adapter-loop finalization cannot erase a replacement owner', async t => {
  const registry = require('../src/adapters'), original = registry.createAdapter;
  t.after(() => { registry.createAdapter = original; });
  const entered = deferred(), release = deferred();
  t.after(() => release.resolve());
  const a = { run: async () => { entered.resolve(); await release.promise; }, stop() {}, wasStopRequested: () => true };
  registry.createAdapter = () => a;
  const d = daemon(a), info = d._processes.test;
  Object.assign(d, { config: { configDir: require('node:os').tmpdir() }, _buildAgentEnv: () => ({}) });
  const running = d._adapterLoop('test', { type: 'codex' }, info, { id: 'w', token: 'test' });
  await entered.promise;
  const replacement = {};
  d._adapters.test = replacement;
  d._processes.test = { proc: null, state: 'running' };
  release.resolve(); await running;
  assert.equal(d._adapters.test, replacement);
  assert.equal(d._processes.test.state, 'running');
});
it('late heartbeat cannot clear terminal stop failure', async () => {
  const a = new BaseAdapter({ workspaceId: 'w', agentName: 'test', token: 'test', endpoint: 'http://127.0.0.1:1', agentEnv: {}, logSink() {} });
  const d = daemon(a), release = deferred();
  a._onStatus = update => d._applyAdapterStatus('test', d._processes.test, update);
  a.client.heartbeat = () => release.promise;
  a._stopLifecycleWork = async () => { throw new Error('termination refused'); };
  const heartbeat = a._heartbeat();
  await assert.rejects(d._killAgent('test', 100), /stop failed/);
  release.resolve(); await heartbeat;
  assert.equal(d._processes.test.state, 'error');
  assert.equal(d._processes.test.errorReason, 'stop_failed');
});
it('restart launched through the daemon waits for old finalization before creating a replacement', async t => {
  const registry = require('../src/adapters'), original = registry.createAdapter;
  t.after(() => { registry.createAdapter = original; });
  const exiting = deferred(), stopEntered = deferred(), replacementExit = deferred(), events = [];
  t.after(() => { exiting.resolve(); replacementExit.resolve(); });
  let created = 0;
  registry.createAdapter = () => {
    const first = created++ === 0;
    events.push(first ? 'create old' : 'create replacement');
    return {
      run: async () => {
        await (first ? exiting.promise : replacementExit.promise);
        events.push(first ? 'old disconnected' : 'replacement disconnected');
      },
      stop: async () => { if (first) stopEntered.resolve(); else replacementExit.resolve(); return { ok: true }; },
      wasStopRequested: () => true,
    };
  };
  const d = daemon(null), agent = { name: 'test', type: 'codex', network: 'w' };
  Object.assign(d, { config: { configDir: require('node:os').tmpdir(), load() {}, getAgent: () => agent },
    _buildAgentEnv: () => ({}), _resolveAgentNetwork: () => ({ id: 'w', token: 'test' }) });
  d._launchAgent(agent);
  assert.ok(d._processes.test.adapterRun instanceof Promise);
  const restarting = d.restartAgent('test');
  await stopEntered.promise; await tick();
  assert.deepEqual(events, ['create old']);
  exiting.resolve(); await restarting;
  assert.deepEqual(events, ['create old', 'old disconnected', 'create replacement']);
  await d.stopAgent('test');
  assert.equal(d._adapters.test, undefined);
});
