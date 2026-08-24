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

  it('_buildRoster lists configured agents with live state', () => {
    const config = new Config(tmpDir);
    config.addAgent({ name: 'coder', type: 'claude' });
    config.setAgentNetwork('coder', 'ws1');
    config.addAgent({ name: 'helper', type: 'codex' });
    config.setAgentNetwork('helper', 'ws1');
    const daemon = new Daemon(config, new EnvManager(tmpDir), new Registry(tmpDir));
    // 'coder' is running; 'helper' has no process entry → reported stopped.
    daemon._processes = { coder: { state: 'running', type: 'claude', restarts: 0 } };
    const roster = daemon._buildRoster({ workspace_slug: 'ws1' });
    assert.deepEqual(
      roster.sort((a, b) => a.name.localeCompare(b.name)),
      [
        { name: 'coder', type: 'claude', status: 'running', model: null, workingDir: null, apiKeyMasked: null },
        { name: 'helper', type: 'codex', status: 'stopped', model: null, workingDir: null, apiKeyMasked: null },
      ],
    );
  });

  it('_buildRoster reports a configured API key masked, never in full', () => {
    const config = new Config(tmpDir);
    config.addAgent({ name: 'coder', type: 'deepseek' });
    config.setAgentNetwork('coder', 'ws1');
    const env = new EnvManager(tmpDir);
    env.save('deepseek', { LLM_API_KEY: 'sk-1234567890abcdef' });
    const daemon = new Daemon(config, env, new Registry(tmpDir));
    const roster = daemon._buildRoster({ workspace_slug: 'ws1' });
    assert.equal(roster[0].apiKeyMasked, 'sk-1...cdef');
    assert.ok(!JSON.stringify(roster).includes('sk-1234567890abcdef'));
  });

  it('_buildRoster fully masks short keys — first4+last4 of a 12-char key would expose most of it', () => {
    const config = new Config(tmpDir);
    config.addAgent({ name: 'coder', type: 'deepseek' });
    config.setAgentNetwork('coder', 'ws1');
    const env = new EnvManager(tmpDir);
    env.save('deepseek', { LLM_API_KEY: 'shortkey12' });
    const daemon = new Daemon(config, env, new Registry(tmpDir));
    const roster = daemon._buildRoster({ workspace_slug: 'ws1' });
    assert.equal(roster[0].apiKeyMasked, '****');
    assert.ok(!JSON.stringify(roster).includes('shortkey12'));
  });

  // Stub node-config with a fixed pairing list, so the heartbeat tests don't
  // touch the developer's real ~/.openagents/node.json.
  function withPairings(pairings, body) {
    const ncPath = require.resolve('../src/node-config');
    const realNc = require.cache[ncPath];
    const cleared = [];
    require.cache[ncPath] = {
      id: ncPath,
      filename: ncPath,
      loaded: true,
      exports: {
        listPairings: () => pairings,
        gatherDeviceInfo: () => ({ hostname: 'h', os: 'linux', deviceType: 'server', launcherVersion: '0' }),
        clearPairing: (wsId) => { cleared.push(wsId); return {}; },
      },
    };
    return Promise.resolve(body(cleared)).finally(() => {
      if (realNc) require.cache[ncPath] = realNc; else delete require.cache[ncPath];
    });
  }

  const P1 = { node_id: 'n1', token: 't1', endpoint: 'https://ws1', workspace_id: 'w1', workspace_slug: 'ws1' };
  const P2 = { node_id: 'n2', token: 't2', endpoint: 'https://ws2', workspace_id: 'w2', workspace_slug: 'ws2' };

  function heartbeatDaemon() {
    const daemon = new Daemon(new Config(tmpDir), new EnvManager(tmpDir), new Registry(tmpDir));
    daemon._buildFs = () => ({});
    daemon._runtimes = [];
    return daemon;
  }

  // The heartbeat is the only component that continuously learns the node was
  // removed (a 404 every 10s). It must clear node.json so the launcher stops
  // reporting a membership that's gone — but only on that definitive signal,
  // never on a transient blip that would unpair a device whose wifi flickered.
  it('_nodeHeartbeat clears the pairing when the workspace 404s the node', async () => {
    await withPairings([P1], async (cleared) => {
      const daemon = heartbeatDaemon();
      daemon._nodeClients.set('w1', {
        nodeHeartbeat: async () => { const e = new Error('Node not found'); e.status = 404; throw e; },
      });
      await daemon._nodeHeartbeat();
      assert.deepEqual(cleared, ['w1'], 'a 404 should clear that pairing');
      assert.equal(daemon._nodeClients.has('w1'), false, 'the stale client should be dropped');
    });
  });

  it('_nodeHeartbeat keeps the pairing on a transient (non-404) failure', async () => {
    await withPairings([P1], async (cleared) => {
      const daemon = heartbeatDaemon();
      const client = {
        nodeHeartbeat: async () => { const e = new Error('temporary'); e.status = 503; throw e; },
      };
      daemon._nodeClients.set('w1', client);
      await daemon._nodeHeartbeat();
      assert.deepEqual(cleared, [], 'a transient failure must not clear the pairing');
      assert.equal(daemon._nodeClients.get('w1'), client, 'the client is retained for retry');
    });
  });

  // A device belongs to a node row in EVERY workspace it paired with, so all of
  // them must be reported to — one pairing does not displace another.
  it('_nodeHeartbeat reports to every paired workspace', async () => {
    await withPairings([P1, P2], async () => {
      const daemon = heartbeatDaemon();
      const seen = [];
      for (const [ws, node] of [['w1', 'n1'], ['w2', 'n2']]) {
        daemon._nodeClients.set(ws, {
          nodeHeartbeat: async (nodeId, token) => { seen.push([nodeId, token]); return {}; },
        });
        void node;
      }
      await daemon._nodeHeartbeat();
      assert.deepEqual(seen.sort(), [['n1', 't1'], ['n2', 't2']]);
    });
  });

  // One workspace being unreachable must not stop the others from reporting.
  it('_nodeHeartbeat keeps reporting to the other workspaces when one fails', async () => {
    await withPairings([P1, P2], async (cleared) => {
      const daemon = heartbeatDaemon();
      let reachedW2 = false;
      daemon._nodeClients.set('w1', {
        nodeHeartbeat: async () => { const e = new Error('Node not found'); e.status = 404; throw e; },
      });
      daemon._nodeClients.set('w2', {
        nodeHeartbeat: async () => { reachedW2 = true; return {}; },
      });
      await daemon._nodeHeartbeat();
      assert.equal(reachedW2, true, 'the healthy pairing still heartbeats');
      assert.deepEqual(cleared, ['w1'], 'only the 404ing pairing is cleared');
    });
  });

  // Each workspace only ever sees the agents bound to it (see _buildRoster).
  it('_nodeHeartbeat sends each workspace its own roster', async () => {
    await withPairings([P1, P2], async () => {
      const daemon = heartbeatDaemon();
      daemon._buildRoster = (n) => [{ name: `agent-for-${n.workspace_slug}` }];
      const rosters = {};
      for (const ws of ['w1', 'w2']) {
        daemon._nodeClients.set(ws, {
          nodeHeartbeat: async (_id, _tok, info) => { rosters[ws] = info.agents; return {}; },
        });
      }
      await daemon._nodeHeartbeat();
      assert.deepEqual(rosters.w1, [{ name: 'agent-for-ws1' }]);
      assert.deepEqual(rosters.w2, [{ name: 'agent-for-ws2' }]);
    });
  });

  it('_runNodeCommand create_agent runs create+connect and reports ok', async () => {
    const daemon = new Daemon(new Config(tmpDir), new EnvManager(tmpDir), new Registry(tmpDir));
    const calls = [];
    daemon._runAgn = async (args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; };
    let reported = null;
    daemon._nodeClients.set('w1', { nodeCommandResult: async (id, tok, res) => { reported = { id, res }; } });
    const wd = path.join(tmpDir, 'wd');
    await daemon._runNodeCommand(
      { node_id: 'n1', workspace_id: 'w1', workspace_slug: 'ws-slug', token: 'tok', endpoint: 'https://ws' },
      { commandId: 'c1', action: 'create_agent', args: { name: 'coder', type: 'claude', apiKey: 'sk-x', workingDir: wd } },
    );

    assert.deepEqual(calls[0], ['create', 'coder', '--type', 'claude', '--install', '--path', wd]);
    assert.deepEqual(calls[1], ['env', 'claude', '--set', 'LLM_API_KEY=sk-x']);
    // Bind by SLUG: the daemon knows which workspace the command came from,
    // so there is no token to pass and no /v1/token/resolve to fail.
    assert.deepEqual(calls[2], ['connect', 'coder', '--workspace', 'ws-slug']);
    assert.equal(reported.id, 'c1');
    assert.equal(reported.res.ok, true);
  });

  it('_runNodeCommand create_agent defaults to a managed working dir', async () => {
    const daemon = new Daemon(new Config(tmpDir), new EnvManager(tmpDir), new Registry(tmpDir));
    const calls = [];
    daemon._runAgn = async (args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; };
    daemon._nodeClients.set('w1', { nodeCommandResult: async () => {} });
    // Sandbox HOME so the managed folder is created under tmp, not the real home.
    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    try {
      await daemon._runNodeCommand(
        { node_id: 'n1', workspace_id: 'w1', token: 'tok', endpoint: 'https://ws' },
        { commandId: 'c3', action: 'create_agent', args: { name: 'coder', type: 'claude' } },
      );
    } finally {
      if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
    }
    // No workingDir given → --path to a managed folder under the launcher home.
    assert.equal(calls[0][5], '--path');
    assert.match(calls[0][6], /[\\/]\.openagents[\\/]agents[\\/]coder$/);
  });

  it('_refreshRuntimes parses child JSON into the roster', async () => {
    const daemon = new Daemon(new Config(tmpDir), new EnvManager(tmpDir), new Registry(tmpDir));
    const runtimes = [{ type: 'claude', installed: true, ready: true, version: '1.0.0' }];
    daemon._runAgn = async (args) => {
      assert.deepEqual(args, ['runtimes', '--json']);
      return { code: 0, stdout: JSON.stringify(runtimes), stderr: '' };
    };
    await daemon._refreshRuntimes();
    assert.deepEqual(daemon._runtimes, runtimes);
  });

  it('_runNodeCommand detect_runtimes refreshes and reports ok', async () => {
    const daemon = new Daemon(new Config(tmpDir), new EnvManager(tmpDir), new Registry(tmpDir));
    let refreshed = false;
    daemon._refreshRuntimes = async () => { refreshed = true; daemon._runtimes = [{ type: 'claude' }]; };
    daemon._nodeHeartbeat = async () => {};
    let reported = null;
    daemon._nodeClients.set('w1', { nodeCommandResult: async (id, tok, res) => { reported = res; } });
    await daemon._runNodeCommand(
      { node_id: 'n1', workspace_id: 'w1', token: 'tok', endpoint: 'https://ws' },
      { commandId: 'c4', action: 'detect_runtimes', args: {} },
    );
    assert.equal(refreshed, true);
    assert.equal(reported.ok, true);
  });

  it('_buildRoster includes model and workingDir', () => {
    const config = new Config(tmpDir);
    config.addAgent({ name: 'coder', type: 'claude', path: '/home/ubuntu/proj', env: { LLM_MODEL: 'sonnet' } });
    config.setAgentNetwork('coder', 'ws1');
    const daemon = new Daemon(config, new EnvManager(tmpDir), new Registry(tmpDir));
    daemon._processes = { coder: { state: 'running', type: 'claude' } };
    const roster = daemon._buildRoster({ workspace_slug: 'ws1' });
    assert.equal(roster[0].model, 'sonnet');
    assert.equal(roster[0].workingDir, '/home/ubuntu/proj');
  });

  it('_buildRoster hides agents connected to a different workspace', () => {
    const config = new Config(tmpDir);
    config.addAgent({ name: 'mine', type: 'claude' });
    config.setAgentNetwork('mine', 'ws1');
    config.addAgent({ name: 'foreign', type: 'claude' });
    config.setAgentNetwork('foreign', 'ws2');
    config.addAgent({ name: 'local-only', type: 'claude' }); // no network
    const daemon = new Daemon(config, new EnvManager(tmpDir), new Registry(tmpDir));
    const roster = daemon._buildRoster({ workspace_slug: 'ws1' });
    assert.deepEqual(roster.map((a) => a.name), ['mine']);
  });

  it('_runNodeCommand configure_agent updates model then restarts', async () => {
    const config = new Config(tmpDir);
    config.addAgent({ name: 'coder', type: 'gemini' });
    config.setAgentNetwork('coder', 'ws1');
    const daemon = new Daemon(config, new EnvManager(tmpDir), new Registry(tmpDir));
    const calls = [];
    daemon._runAgn = async (args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; };
    // The restart happens in-process (NOT via `agn stop`/`agn start` —
    // writeCommand() overwrites daemon.cmd, so that pair can drop one side).
    const restarted = [];
    daemon.restartAgent = async (name) => { restarted.push(name); };
    let reported = null;
    daemon._nodeClients.set('w1', { nodeCommandResult: async (id, tok, res) => { reported = res; } });
    await daemon._runNodeCommand(
      { node_id: 'n1', workspace_id: 'w1', token: 'tok', endpoint: 'https://ws', workspace_slug: 'ws1' },
      { commandId: 'c9', action: 'configure_agent', args: { name: 'coder', type: 'gemini', model: 'gemini-2.5-flash' } },
    );
    // Sets the generic LLM_MODEL plus gemini's native GEMINI_MODEL, then restarts.
    assert.deepEqual(calls[0], ['env', 'gemini', '--set', 'LLM_MODEL=gemini-2.5-flash']);
    assert.deepEqual(calls[1], ['env', 'gemini', '--set', 'GEMINI_MODEL=gemini-2.5-flash']);
    assert.deepEqual(restarted, ['coder']);
    assert.equal(reported.ok, true);
  });

  it('_buildFs returns home and its subfolders', () => {
    const daemon = new Daemon(new Config(tmpDir), new EnvManager(tmpDir), new Registry(tmpDir));
    const fsInfo = daemon._buildFs();
    assert.ok(typeof fsInfo.home === 'string' && fsInfo.home.length > 0);
    assert.ok(Array.isArray(fsInfo.dirs));
  });

  it('_listDir lists subfolders of a directory', () => {
    const daemon = new Daemon(new Config(tmpDir), new EnvManager(tmpDir), new Registry(tmpDir));
    fs.mkdirSync(path.join(tmpDir, 'alpha'));
    fs.mkdirSync(path.join(tmpDir, 'beta'));
    fs.mkdirSync(path.join(tmpDir, '.hidden'));
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'x');
    const res = daemon._listDir(tmpDir);
    assert.deepEqual(res.dirs, ['alpha', 'beta']);
    assert.equal(res.path, tmpDir);
    assert.ok(res.parent);
  });

  it('_runNodeCommand list_dir returns folder data', async () => {
    const daemon = new Daemon(new Config(tmpDir), new EnvManager(tmpDir), new Registry(tmpDir));
    fs.mkdirSync(path.join(tmpDir, 'proj'));
    let reported = null;
    daemon._nodeClients.set('w1', { nodeCommandResult: async (id, tok, res) => { reported = res; } });
    await daemon._runNodeCommand(
      { node_id: 'n1', workspace_id: 'w1', token: 'tok', endpoint: 'https://ws' },
      { commandId: 'cd', action: 'list_dir', args: { path: tmpDir } },
    );
    assert.equal(reported.ok, true);
    assert.deepEqual(reported.data.dirs, ['proj']);
  });

  it('_runNodeCommand reports error when a step fails', async () => {
    const config = new Config(tmpDir);
    config.addAgent({ name: 'coder', type: 'claude' });
    config.setAgentNetwork('coder', 'ws1');
    const daemon = new Daemon(config, new EnvManager(tmpDir), new Registry(tmpDir));
    daemon._runAgn = async () => ({ code: 1, stdout: '', stderr: 'boom' });
    let reported = null;
    daemon._nodeClients.set('w1', { nodeCommandResult: async (id, tok, res) => { reported = res; } });
    await daemon._runNodeCommand(
      { node_id: 'n1', workspace_id: 'w1', token: 'tok', endpoint: 'https://ws', workspace_slug: 'ws1' },
      { commandId: 'c2', action: 'stop_agent', args: { name: 'coder' } },
    );
    assert.equal(reported.ok, false);
    assert.match(reported.message, /boom/);
  });

  it('_runNodeCommand refuses to act on an agent from another workspace', async () => {
    const config = new Config(tmpDir);
    config.addAgent({ name: 'foreign', type: 'claude' });
    config.setAgentNetwork('foreign', 'ws2'); // belongs to another workspace
    const daemon = new Daemon(config, new EnvManager(tmpDir), new Registry(tmpDir));
    let ranAgn = false;
    daemon._runAgn = async () => { ranAgn = true; return { code: 0, stdout: '', stderr: '' }; };
    let reported = null;
    daemon._nodeClients.set('w1', { nodeCommandResult: async (id, tok, res) => { reported = res; } });
    await daemon._runNodeCommand(
      { node_id: 'n1', workspace_id: 'w1', token: 'tok', endpoint: 'https://ws', workspace_slug: 'ws1' },
      { commandId: 'cx', action: 'stop_agent', args: { name: 'foreign' } },
    );
    // The command must NOT run and must report a clear refusal.
    assert.equal(ranAgn, false);
    assert.equal(reported.ok, false);
    assert.match(reported.message, /not managed by this workspace/);
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

// Regression guard for the orphaned-daemon bug: a live daemon whose pid only
// survives in the status file (stale/clobbered pid file) must still be seen by
// `agn status` and killed by `agn down`, instead of being reported "stopped"
// and left running to block every subsequent `agn up`.
describe('Daemon pid resolution (dual-source)', () => {
  const { spawn } = require('node:child_process');

  // A child we can control: it ignores nothing, so SIGTERM terminates it.
  function spawnDummy() {
    return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
  }
  // Kill a child and wait until it is fully reaped, so process.kill(pid, 0)
  // reports ESRCH (a reaped pid is genuinely dead, not a zombie).
  function killAndReap(proc) {
    return new Promise((resolve) => {
      proc.once('exit', resolve);
      try { proc.kill('SIGKILL'); } catch { resolve(); }
    });
  }

  it('stopDaemon kills the live daemon from the status file when the pid file is stale', async () => {
    const dead = spawnDummy();
    const deadPid = dead.pid;
    await killAndReap(dead); // deadPid is now a genuinely dead pid

    const live = spawnDummy();
    const livePid = live.pid;
    const liveExited = new Promise((r) => live.once('exit', r));

    fs.writeFileSync(path.join(tmpDir, 'daemon.pid'), String(deadPid), 'utf-8');
    fs.writeFileSync(
      path.join(tmpDir, 'daemon.status.json'),
      JSON.stringify({ pid: livePid, agents: {} }),
      'utf-8',
    );

    try {
      const result = Daemon.stopDaemon(tmpDir);
      await liveExited;
      assert.equal(result, true);
      assert.equal(Daemon._isAlive(livePid), false, 'live daemon should have been killed');
      assert.ok(!fs.existsSync(path.join(tmpDir, 'daemon.pid')), 'pid file should be cleaned');
      assert.ok(!fs.existsSync(path.join(tmpDir, 'daemon.status.json')), 'status file should be cleaned');
    } finally {
      if (Daemon._isAlive(livePid)) await killAndReap(live);
    }
  });

  it('readDaemonPid falls back to the status file when the pid file is stale', async () => {
    const dead = spawnDummy();
    const deadPid = dead.pid;
    await killAndReap(dead);

    const live = spawnDummy();
    const livePid = live.pid;

    fs.writeFileSync(path.join(tmpDir, 'daemon.pid'), String(deadPid), 'utf-8');
    fs.writeFileSync(
      path.join(tmpDir, 'daemon.status.json'),
      JSON.stringify({ pid: livePid, agents: {} }),
      'utf-8',
    );

    try {
      assert.equal(Daemon.readDaemonPid(tmpDir), livePid);
    } finally {
      await killAndReap(live);
    }
  });

  it('readDaemonPid returns null and cleans up when nothing is alive', async () => {
    const dead = spawnDummy();
    const deadPid = dead.pid;
    await killAndReap(dead);

    fs.writeFileSync(path.join(tmpDir, 'daemon.pid'), String(deadPid), 'utf-8');
    assert.equal(Daemon.readDaemonPid(tmpDir), null);
    assert.ok(!fs.existsSync(path.join(tmpDir, 'daemon.pid')), 'stale pid file should be cleaned');
  });
});
