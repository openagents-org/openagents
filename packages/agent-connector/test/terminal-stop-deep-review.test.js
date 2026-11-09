'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { Daemon } = require('../src/daemon');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
function daemon(adapter, finalizer) {
  const d = Object.create(Daemon.prototype), events = [];
  Object.assign(d, { _adapters: { test: adapter }, _processes: { test: { proc: null, state: 'running', adapterRun: finalizer } },
    _stoppedAgents: new Set(), _writeStatus() {}, _log() {},
    _cleanupPid() { events.push('pid removed'); }, _shutdownResolve() { events.push('shutdown resolved'); } });
  return { d, events };
}
it('whole-daemon shutdown retains PID and all callers wait for adapter finalization', async t => {
  const release = deferred(); t.after(() => release.resolve());
  const { d, events } = daemon({ stop: async () => ({ ok: true }) }, release.promise);
  const first = d.stop();
  let secondDone = false;
  const second = d.stop().then(() => { secondDone = true; });
  await tick();
  assert.deepEqual(events, [], 'shutdown cannot advertise completion before disconnect');
  assert.equal(secondDone, false, 'repeat stop must await the same lifecycle');
  release.resolve(); await Promise.all([first, second]);
  assert.deepEqual(events, ['pid removed', 'shutdown resolved']);
});
it('whole-daemon shutdown failure remains a rejection on repeated stop', async () => {
  const adapter = { stop: async () => ({ ok: false, message: 'termination refused' }) };
  const { d, events } = daemon(adapter);
  await assert.rejects(d.stop(), /termination refused/);
  await assert.rejects(d.stop(), /termination refused/);
  assert.equal(d._adapters.test, adapter);
  assert.equal(d._processes.test.errorReason, 'stop_failed');
  assert.deepEqual(events, []);
});
it('restart already awaiting finalization cannot launch after daemon shutdown starts', async t => {
  const registry = require('../src/adapters'), original = registry.createAdapter;
  const release = deferred();
  t.after(() => { release.resolve(); registry.createAdapter = original; });
  let created = 0;
  registry.createAdapter = () => {
    created++;
    return { run: async () => {}, stop: async () => ({ ok: true }), wasStopRequested: () => true };
  };
  const { d } = daemon({ stop: async () => ({ ok: true }) }, release.promise);
  const agent = { name: 'test', type: 'codex', network: 'w' };
  Object.assign(d, { config: { configDir: require('node:os').tmpdir(), load() {}, getAgent: () => agent },
    _buildAgentEnv: () => ({}), _logAs() {}, _resolveAgentNetwork: () => ({ id: 'w', token: 'test' }) });
  const restarting = d.restartAgent('test');
  const stopping = d.stop();
  release.resolve();
  await Promise.all([restarting, stopping]);
  assert.equal(created, 0, 'shutdown must fence every launch, including an earlier restart');
});

for (const wholeDaemon of [false, true]) {
  it(`failed runtime repair cannot start an adapter after ${wholeDaemon ? 'daemon shutdown' : 'agent stop'}`, async t => {
    const registry = require('../src/adapters'), original = registry.createAdapter;
    const release = deferred();
    t.after(() => { release.resolve(); registry.createAdapter = original; });
    let started = 0;
    registry.createAdapter = () => ({
      preflight: () => ({ ok: false, repairable: true }),
      run: async () => { started++; },
      stop: async () => ({ ok: true }),
      wasStopRequested: () => false,
    });
    const { d } = daemon(null);
    const agent = { name: 'test', type: 'codex', network: 'w' };
    Object.assign(d, { config: { configDir: require('node:os').tmpdir() },
      _buildAgentEnv: () => ({}), _logAs() {},
      _resolveAgentNetwork: () => ({ id: 'w', token: 'test' }),
      _repairRuntime: async () => { await release.promise; throw new Error('repair failed'); },
    });
    d._launchAgent(agent);
    const stopping = wholeDaemon ? d.stop() : d.stopAgent('test');
    release.resolve();
    await stopping;
    assert.equal(started, 0, 'failed preparation must still honor terminal admission');
    assert.equal(d._adapters.test == null, true);
    assert.equal(d._processes.test.state, 'stopped');
  });
}
