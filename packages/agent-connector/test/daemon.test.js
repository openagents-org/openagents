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

  it('readDaemonPid returns null when no pid file', () => {
    assert.equal(Daemon.readDaemonPid(tmpDir), null);
  });

  it('readDaemonPid reads valid pid', () => {
    fs.writeFileSync(path.join(tmpDir, 'daemon.pid'), String(process.pid), 'utf-8');
    assert.equal(Daemon.readDaemonPid(tmpDir), process.pid);
  });

  it('readDaemonPid returns pid without validating liveness', () => {
    fs.writeFileSync(path.join(tmpDir, 'daemon.pid'), '99999999', 'utf-8');
    // PID validation removed — returns raw value (liveness checked elsewhere)
    assert.equal(Daemon.readDaemonPid(tmpDir), 99999999);
  });
});
