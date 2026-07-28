'use strict';

/**
 * Tests for the OpenCode working-directory fix (issue #435).
 *
 * opencode only lets an agent touch files inside the `--dir` worktree root; in
 * headless mode a tool call outside it is auto-rejected. The adapter used to
 * hardcode `--dir`/`cwd` to the per-agent scratch dir (agentHome), ignoring the
 * configured `path` (workingDir) — so the agent ran in an empty dir and could
 * never reach the project. These tests pin: opencode runs in the configured
 * working dir, and stored session IDs (which are tied to `--dir`) are scoped per
 * working dir so a path change can't poison a run with a stale, unresumable ID.
 *
 * `child_process.spawn` is faked (installed before the adapter is required, like
 * test/aider.test.js) so the real `--dir`/`cwd` passed to the subprocess can be
 * asserted without a CLI, network, or model.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

// Swappable spawn shim installed BEFORE requiring the adapter so the
// module-level `const { spawn } = require('child_process')` binds to it.
const realSpawn = cp.spawn;
let spawnImpl = null;
let lastSpawn = null;
cp.spawn = (...args) => spawnImpl(...args);

const OpenCodeAdapter = require('../src/adapters/opencode');

after(() => { cp.spawn = realSpawn; });

function makeAdapter(overrides = {}) {
  const adapter = new OpenCodeAdapter({
    workspaceId: 'ws',
    channelName: 'thread',
    token: 'token',
    agentName: 'opencode-wd-test',
    ...overrides,
  });
  adapter._log = () => {};
  return adapter;
}

// Minimal opencode stdout: one assistant text event, then the adapter resolves.
function makeFakeSpawn() {
  return (cmd, args, opts) => {
    const proc = new EventEmitter();
    proc.pid = 4242;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = new EventEmitter();
    proc.stdin.write = () => true;
    proc.stdin.end = () => {};
    lastSpawn = { cmd, args, opts };
    setImmediate(() => {
      proc.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"ok"}}\n', 'utf-8'));
      proc.emit('close', 0, null);
    });
    return proc;
  };
}

// Drive `_runOpencode` with preflight stubbed to pass + spawn faked.
async function captureRun(adapter, channel = 'thread') {
  spawnImpl = makeFakeSpawn();
  lastSpawn = null;
  adapter._opencodeBinary = '/fake/opencode';
  adapter._preflight = () => ({ ok: true, model: 'openai/gpt-4o', credential: 'present' });
  adapter._resolveModel = () => 'openai/gpt-4o';
  adapter._ensureWorkspaceSkill = () => {};
  adapter._buildSystemContext = () => '';
  adapter._persistSessionId = () => {};
  await adapter._runOpencode('hi', channel);
  return lastSpawn;
}

describe('OpenCode — working directory (#435)', () => {
  it('_resolveCwd uses the configured workingDir', () => {
    const a = makeAdapter({ workingDir: '/tmp/proj-435' });
    assert.equal(a._resolveCwd(), '/tmp/proj-435');
  });

  it('_resolveCwd falls back to agentHome when no workingDir is configured', () => {
    const a = makeAdapter();
    assert.equal(a._resolveCwd(), a.agentHome);
  });

  it('spawns opencode with --dir and cwd set to the configured workingDir', async () => {
    const a = makeAdapter({ workingDir: '/tmp/proj-435' });
    const spawn = await captureRun(a);
    assert.ok(spawn, 'opencode was spawned');
    const dirIdx = spawn.args.indexOf('--dir');
    assert.ok(dirIdx >= 0, '--dir is on the command line');
    assert.equal(spawn.args[dirIdx + 1], '/tmp/proj-435', '--dir is the configured workingDir');
    assert.equal(spawn.opts.cwd, '/tmp/proj-435', 'spawn cwd is the configured workingDir');
  });

  it('falls back to agentHome for --dir/cwd when no workingDir is configured (back-compat)', async () => {
    const a = makeAdapter();
    const spawn = await captureRun(a);
    const dirIdx = spawn.args.indexOf('--dir');
    assert.equal(spawn.args[dirIdx + 1], a.agentHome);
    assert.equal(spawn.opts.cwd, a.agentHome);
  });

  it('scopes the persisted session store per working dir', () => {
    const legacy = makeAdapter(); // no workingDir → back-compat legacy file
    assert.equal(
      path.basename(legacy._sessionsFile),
      'sessions.json',
      'no workingDir keeps the legacy sessions.json so existing agents keep their context',
    );

    const projA = makeAdapter({ workingDir: '/tmp/proj-a' });
    const projB = makeAdapter({ workingDir: '/tmp/proj-b' });
    const slugA = crypto.createHash('sha256').update('/tmp/proj-a').digest('hex').slice(0, 16);
    assert.equal(
      path.basename(projA._sessionsFile),
      `sessions-${slugA}.json`,
      'a workingDir gets a per-dir scoped file',
    );
    assert.notEqual(projA._sessionsFile, projB._sessionsFile, 'different dirs → different files');
    assert.equal(
      path.dirname(projA._sessionsFile),
      projA.agentHome,
      'scoped files still live under agentHome, never inside the project',
    );
  });

  it('preflight reports cwd_unavailable (naming the configured dir) when the workingDir is inaccessible', () => {
    const a = makeAdapter({ workingDir: '/definitely/not/a/real/path/opencode-435' });
    a._opencodeBinary = '/fake/opencode';
    a._findOpencodeBinary = () => '/fake/opencode';
    a._detectCliVersion = () => ({ version: '1.17.11', executable: true });
    a.agentEnv = { LLM_MODEL: 'gpt-4o', OPENAI_API_KEY: 'x' };
    const r = a._preflight('thread');
    assert.equal(r.ok, false);
    assert.equal(r.category, 'cwd_unavailable');
    assert.match(r.diagnostic || '', /opencode-435/, 'diagnostic names the inaccessible working dir');
  });

  it('preflight passes when the configured workingDir is accessible', () => {
    const accessible = os.tmpdir();
    const a = makeAdapter({ workingDir: accessible });
    a._opencodeBinary = '/fake/opencode';
    a._findOpencodeBinary = () => '/fake/opencode';
    a._detectCliVersion = () => ({ version: '1.17.11', executable: true });
    a.agentEnv = { LLM_MODEL: 'gpt-4o', OPENAI_API_KEY: 'x' };
    const r = a._preflight('thread');
    assert.equal(r.ok, true);
  });
});
