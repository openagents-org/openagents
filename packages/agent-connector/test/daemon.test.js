'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Daemon } = require('../src/daemon');
const { Config } = require('../src/config');
const { EnvManager } = require('../src/env');
const { Registry } = require('../src/registry');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-daemon-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Daemon', () => {
  it('creates with correct initial state', () => {
    const config = new Config(tmpDir);
    const env = new EnvManager(tmpDir);
    const reg = new Registry(tmpDir);
    const daemon = new Daemon(config, env, reg);

    assert.deepEqual(daemon.getStatus(), {});
    assert.equal(daemon._shuttingDown, false);
  });

  it('getStatus returns empty when no agents', () => {
    const config = new Config(tmpDir);
    const env = new EnvManager(tmpDir);
    const reg = new Registry(tmpDir);
    const daemon = new Daemon(config, env, reg);

    assert.deepEqual(daemon.getStatus(), {});
  });

  it('_buildAgentEnv merges saved + resolved env', () => {
    const config = new Config(tmpDir);
    const env = new EnvManager(tmpDir);
    const reg = new Registry(tmpDir);
    const daemon = new Daemon(config, env, reg);

    // Save some env vars
    env.save('openclaw', { LLM_API_KEY: 'sk-test', LLM_BASE_URL: 'https://api.openai.com/v1' });

    const result = daemon._buildAgentEnv({ name: 'test', type: 'openclaw' });
    assert.equal(result.LLM_API_KEY, 'sk-test');
    // Should have resolved vars too
    assert.equal(result.OPENAI_API_KEY, 'sk-test');
  });

  it('_buildAgentEnv lets per-agent env override type defaults', () => {
    const config = new Config(tmpDir);
    const env = new EnvManager(tmpDir);
    const reg = new Registry(tmpDir);
    const daemon = new Daemon(config, env, reg);

    env.save('opencode', {
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      LLM_MODEL: 'default-model',
    });

    const result = daemon._buildAgentEnv({
      name: 'agent-a',
      type: 'opencode',
      env: { LLM_MODEL: 'custom-model' },
    });

    assert.equal(result.LLM_BASE_URL, 'https://openrouter.ai/api/v1');
    assert.equal(result.LLM_MODEL, 'custom-model');
    assert.equal(result.OPENCODE_MODEL, 'custom-model');
  });

  it('_getLaunchCommand returns command from registry', () => {
    const config = new Config(tmpDir);
    const env = new EnvManager(tmpDir);
    const reg = new Registry(tmpDir);
    const daemon = new Daemon(config, env, reg);

    const cmd = daemon._getLaunchCommand({ name: 'test', type: 'claude' });
    assert.ok(cmd);
    assert.equal(cmd[0], 'claude');
    // Claude has launch args
    assert.ok(cmd.length > 1);
    assert.ok(cmd[1].includes('--append-system-prompt'));
  });

  it('_getLaunchCommand substitutes agent_name', () => {
    const config = new Config(tmpDir);
    const env = new EnvManager(tmpDir);
    const reg = new Registry(tmpDir);
    const daemon = new Daemon(config, env, reg);

    const cmd = daemon._getLaunchCommand({ name: 'my-bot', type: 'claude' });
    assert.ok(cmd.some((arg) => arg.includes('my-bot')));
  });

  it('_getLaunchCommand returns null for unknown type', () => {
    const config = new Config(tmpDir);
    const env = new EnvManager(tmpDir);
    const reg = new Registry(tmpDir);
    const daemon = new Daemon(config, env, reg);

    const cmd = daemon._getLaunchCommand({ name: 'test', type: 'nonexistent-xyz' });
    assert.equal(cmd, null);
  });

  it('_writeStatus creates status file', () => {
    const config = new Config(tmpDir);
    const env = new EnvManager(tmpDir);
    const reg = new Registry(tmpDir);
    const daemon = new Daemon(config, env, reg);

    daemon._writeStatus();
    assert.ok(fs.existsSync(config.statusFile));

    const status = JSON.parse(fs.readFileSync(config.statusFile, 'utf-8'));
    assert.ok(status.agents);
    assert.equal(status.pid, process.pid);
  });

  it('_processCommands handles stop command', async () => {
    const config = new Config(tmpDir);
    const env = new EnvManager(tmpDir);
    const reg = new Registry(tmpDir);
    const daemon = new Daemon(config, env, reg);

    // Create a fake process entry
    daemon._processes['test-agent'] = {
      state: 'running', proc: null, restarts: 0,
      type: 'openclaw', network: '(local)',
    };

    // Write stop command
    fs.writeFileSync(config.cmdFile, 'stop:test-agent\n', 'utf-8');
    daemon._processCommands();

    assert.ok(daemon._stoppedAgents.has('test-agent'));
  });

  it('_processCommands parses restart command', () => {
    const config = new Config(tmpDir);
    config.addAgent({ name: 'r-agent', type: 'openclaw', role: 'worker' });
    const env = new EnvManager(tmpDir);
    const reg = new Registry(tmpDir);
    const daemon = new Daemon(config, env, reg);

    daemon._processes['r-agent'] = {
      state: 'running', proc: null, restarts: 0,
      type: 'openclaw', network: '(local)',
    };

    // Stub restartAgent to verify it gets called without spawning
    let restarted = null;
    daemon.restartAgent = async (name) => { restarted = name; };

    fs.writeFileSync(config.cmdFile, 'restart:r-agent\n', 'utf-8');
    daemon._processCommands();

    assert.equal(restarted, 'r-agent');
  });

  it('start command is idempotent — skips restart when already running', () => {
    const config = new Config(tmpDir);
    config.addAgent({ name: 's-agent', type: 'openclaw', role: 'worker' });
    const daemon = new Daemon(config, new EnvManager(tmpDir), new Registry(tmpDir));

    // Already running with a live adapter — a blind restart here would tear
    // down the joined workspace session and re-join, getting the first session
    // revoked (agent stops after "thinking..."). `start:` must NOT restart it.
    daemon._adapters['s-agent'] = { stop() {} };
    daemon._processes['s-agent'] = { state: 'running', proc: null, restarts: 0 };

    let restarted = null;
    daemon.restartAgent = async (name) => { restarted = name; };

    fs.writeFileSync(config.cmdFile, 'start:s-agent\n', 'utf-8');
    daemon._processCommands();

    assert.equal(restarted, null, 'start: must not restart an already-running agent');
  });

  it('start command launches the agent when it is not running', () => {
    const config = new Config(tmpDir);
    config.addAgent({ name: 's-agent', type: 'openclaw', role: 'worker' });
    const daemon = new Daemon(config, new EnvManager(tmpDir), new Registry(tmpDir));

    // No adapter and no live process → start: must (re)launch it.
    let restarted = null;
    daemon.restartAgent = async (name) => { restarted = name; };

    fs.writeFileSync(config.cmdFile, 'start:s-agent\n', 'utf-8');
    daemon._processCommands();

    assert.equal(restarted, 's-agent', 'start: must launch an agent that is not running');
  });

  it('readDaemonPid returns null when no pid file', () => {
    assert.equal(Daemon.readDaemonPid(tmpDir), null);
  });

  it('readDaemonPid reads valid pid', () => {
    fs.writeFileSync(path.join(tmpDir, 'daemon.pid'), String(process.pid), 'utf-8');
    assert.equal(Daemon.readDaemonPid(tmpDir), process.pid);
  });

  it('readDaemonPid removes stale pid and status files', () => {
    const pidFile = path.join(tmpDir, 'daemon.pid');
    const statusFile = path.join(tmpDir, 'daemon.status.json');

    fs.writeFileSync(pidFile, '99999999', 'utf-8');
    fs.writeFileSync(statusFile, '{"agents":{}}', 'utf-8');

    assert.equal(Daemon.readDaemonPid(tmpDir), null);
    assert.equal(fs.existsSync(pidFile), false);
    assert.equal(fs.existsSync(statusFile), false);
  });

  it('_reload is serialized (concurrent calls queue)', async () => {
    const config = new Config(tmpDir);
    const env = new EnvManager(tmpDir);
    const reg = new Registry(tmpDir);
    const daemon = new Daemon(config, env, reg);

    // Track how many times _reloadUnsafe actually runs concurrently vs. serially.
    const order = [];
    let inFlight = 0;
    let maxConcurrent = 0;
    daemon._reloadUnsafe = async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      order.push('start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('end');
      inFlight--;
    };

    // Fire 3 reloads concurrently; they should all run (each sees the config
    // might have changed) but never overlap.
    await Promise.all([daemon._reload(), daemon._reload(), daemon._reload()]);

    assert.equal(maxConcurrent, 1, '_reloadUnsafe must never run concurrently');
    // 3 start/end pairs, always alternating
    assert.equal(order.length, 6);
    for (let i = 0; i < order.length; i += 2) {
      assert.equal(order[i], 'start');
      assert.equal(order[i + 1], 'end');
    }
  });

  it('_ensureAdapterCleared force-releases stuck adapter', async () => {
    const config = new Config(tmpDir);
    const env = new EnvManager(tmpDir);
    const reg = new Registry(tmpDir);
    const daemon = new Daemon(config, env, reg);

    let stopped = false;
    daemon._adapters['stuck'] = {
      stop: () => { stopped = true; },
    };
    // Override _sleep to make the test fast (returns immediately)
    daemon._sleep = () => Promise.resolve();

    await daemon._ensureAdapterCleared('stuck');

    assert.equal(stopped, true, 'adapter.stop() must be called when slot is stuck');
    assert.equal(daemon._adapters['stuck'], undefined, 'stuck adapter slot must be cleared');
  });

  it('_ensureAdapterCleared returns quickly when slot is already free', async () => {
    const config = new Config(tmpDir);
    const env = new EnvManager(tmpDir);
    const reg = new Registry(tmpDir);
    const daemon = new Daemon(config, env, reg);

    // No adapter in the slot
    const t0 = Date.now();
    await daemon._ensureAdapterCleared('nonexistent');
    const elapsed = Date.now() - t0;

    assert.ok(elapsed < 100, `should return immediately, took ${elapsed}ms`);
  });
});
