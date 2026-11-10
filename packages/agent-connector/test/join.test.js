'use strict';

/**
 * `agn join <code>`: run from inside Claude Code / Codex, it pairs the device,
 * creates a workspace agent of the host's kind — signed in the host's way, and
 * for Claude Code starting each new thread from a fork of the host's
 * conversation — and starts it at login.
 *
 * Run: node --test test/join.test.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// HOME must point at a sandbox BEFORE node-config computes its file path.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agn-join-home-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  detectHostAgent, sandboxedHost, hostFreeEnv, hostAuthEnv,
  claudeProjectDir, findClaudeTranscript, snapshotTranscript,
  pickOpencodeSession, opencodeSessionModel, opencodeTranscript,
} = require('../src/host-agent');
const OpenCodeAdapter = require('../src/adapters/opencode');
const { join, defaultAgentName } = require('../src/join');
const { Config } = require('../src/config');
const { ensureDurableInstall, compareVersions } = require('../src/durable-install');
const autostart = require('../src/autostart');
const ClaudeAdapter = require('../src/adapters/claude');

after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

const CLAUDE_HOST = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'abc-123', CLAUDE_PID: '42', CLAUDE_CODE_ENTRYPOINT: 'cli' };

describe('detectHostAgent', () => {
  it('recognises Claude Code and its session', () => {
    assert.deepEqual(detectHostAgent(CLAUDE_HOST), { type: 'claude', label: 'Claude Code', sessionId: 'abc-123' });
  });
  it('recognises Codex', () => {
    assert.equal(detectHostAgent({ CODEX_SESSION_ID: 't-1' }).type, 'codex');
    assert.equal(detectHostAgent({ CODEX_SESSION_ID: 't-1' }).sessionId, 't-1');
  });
  it('recognises OpenCode, which exports no session id', () => {
    assert.deepEqual(detectHostAgent({ OPENCODE: '1', OPENCODE_PID: '7', AGENT: '1' }), { type: 'opencode', label: 'OpenCode', sessionId: null });
  });
  it('returns null outside any agent', () => {
    assert.equal(detectHostAgent({ PATH: '/usr/bin', HOME: '/h' }), null);
  });
  it('sees the Codex sandbox', () => {
    assert.equal(sandboxedHost({ CODEX_SANDBOX: 'seatbelt' }), true);
    assert.equal(sandboxedHost({}), false);
  });
});

describe('hostFreeEnv', () => {
  it('drops the host session variables and keeps sign-in ones', () => {
    const out = hostFreeEnv({
      ...CLAUDE_HOST, CLAUDE_CODE_MESSAGING_TOKEN: 'x', CLAUDE_CODE_USE_VERTEX: '1',
      CODEX_SESSION_ID: 't', CODEX_HOME: '/c', PATH: '/usr/bin', AI_AGENT: 'claude-code',
    });
    assert.deepEqual(out, { CLAUDE_CODE_USE_VERTEX: '1', CODEX_HOME: '/c', PATH: '/usr/bin' });
  });
});

describe('hostAuthEnv', () => {
  it('copies how Claude signs in and names the secrets among it', () => {
    const { env, secrets } = hostAuthEnv('claude', {
      CLAUDE_CONFIG_DIR: '/cfg', ANTHROPIC_API_KEY: 'sk-1', CLAUDE_CODE_USE_VERTEX: '1', OPENAI_API_KEY: 'no',
    });
    assert.deepEqual(env, { CLAUDE_CONFIG_DIR: '/cfg', ANTHROPIC_API_KEY: 'sk-1', CLAUDE_CODE_USE_VERTEX: '1' });
    assert.deepEqual(secrets, ['ANTHROPIC_API_KEY']);
  });
  it('keeps CODEX_HOME for Codex', () => {
    assert.deepEqual(hostAuthEnv('codex', { CODEX_HOME: '/x' }), { env: { CODEX_HOME: '/x' }, secrets: [] });
  });
});

describe('Claude transcripts', () => {
  it('encodes a cwd the way Claude Code names its project directories', () => {
    assert.equal(claudeProjectDir('/c', '/home/a_b/.openagents/x'), path.join('/c', 'projects', '-home-a-b--openagents-x'));
  });
  it('finds a session in any project and snapshots only complete lines', () => {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-cfg-'));
    const proj = path.join(cfg, 'projects', '-repo');
    fs.mkdirSync(proj, { recursive: true });
    const src = path.join(proj, 's-1.jsonl');
    fs.writeFileSync(src, '{"a":1}\n{"b":2}\n{"half":');
    assert.equal(findClaudeTranscript('s-1', cfg), src);
    assert.equal(findClaudeTranscript('missing', cfg), null);
    assert.equal(findClaudeTranscript('../etc', cfg), null);
    const dest = snapshotTranscript(src, path.join(cfg, 'projects', '-agent'));
    assert.equal(fs.readFileSync(dest, 'utf-8'), '{"a":1}\n{"b":2}\n');
    fs.rmSync(cfg, { recursive: true, force: true });
  });
});

// What `opencode export <id>` prints (1.17), trimmed.
const OC_EXPORT = {
  info: { id: 'ses_1', directory: '/repo', model: { id: 'claude-haiku-5-5@default', providerID: 'google-vertex-anthropic' } },
  messages: [
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'Remember OTTER-77, then list files.' }] },
    { info: { role: 'assistant', providerID: 'google-vertex-anthropic', modelID: 'claude-haiku-5-5@default' }, parts: [
      { type: 'reasoning', text: 'private' },
      { type: 'tool', tool: 'bash', state: { input: { command: 'ls' }, output: 'a.txt' } },
      { type: 'text', text: 'Remembered. There is a.txt.' },
    ] },
  ],
};

describe('OpenCode sessions', () => {
  it("picks the newest session in the command's directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-dir-'));
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-other-'));
    const s = pickOpencodeSession([
      { id: 'old', directory: dir, updated: 1 }, { id: 'new', directory: dir, updated: 5 }, { id: 'elsewhere', directory: other, updated: 9 },
    ], dir);
    assert.equal(s.id, 'new');
    assert.equal(pickOpencodeSession([{ id: 'x', directory: other, updated: 1 }], dir), null);
    assert.equal(pickOpencodeSession(null, dir), null);
  });
  it("reads the session's model", () => {
    assert.equal(opencodeSessionModel(OC_EXPORT), 'google-vertex-anthropic/claude-haiku-5-5@default');
    assert.equal(opencodeSessionModel({ messages: OC_EXPORT.messages }), 'google-vertex-anthropic/claude-haiku-5-5@default');
    assert.equal(opencodeSessionModel({}), null);
  });
  it('turns the session into a transcript without reasoning, newest part kept', () => {
    const t = opencodeTranscript(OC_EXPORT);
    assert.match(t, /User: Remember OTTER-77/);
    assert.match(t, /\[You ran bash \{"command":"ls"\} → a\.txt\]/);
    assert.match(t, /You: Remembered\. There is a\.txt\./);
    assert.ok(!t.includes('private'));
    const short = opencodeTranscript(OC_EXPORT, 40);
    assert.match(short, /^\[…earlier part omitted…\]/);
    assert.ok(short.endsWith('There is a.txt.'));
  });
});

describe('OpenCodeAdapter seed conversation', () => {
  const skip = process.platform === 'win32' ? 'uses a shell script as the opencode binary' : false;
  function adapterWith(seed, exportJson, { exitCode = 0 } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-fake-'));
    const bin = path.join(dir, 'opencode');
    fs.writeFileSync(path.join(dir, 'export.json'), JSON.stringify(exportJson));
    fs.writeFileSync(bin, `#!/bin/sh\n[ "$1" = export ] && [ "$2" = "${seed ? seed.session_id : ''}" ] && cat "${path.join(dir, 'export.json')}"\nexit ${exitCode}\n`, { mode: 0o755 });
    const a = new OpenCodeAdapter({
      workspaceId: 'ws', channelName: 'general', token: 'tok', agentName: `oc-${Math.random().toString(36).slice(2)}`,
      agentEnv: { PATH: process.env.PATH }, seedSession: seed,
    });
    a._opencodeBinary = bin;
    a._ensureWorkspaceSkill = () => {};
    a._buildSystemContext = () => 'CONTEXT';
    a._saveSessions = () => {};
    a._channelSessions = {};
    return a;
  }

  it("puts the chat's transcript in a channel's first prompt only", { skip }, () => {
    const a = adapterWith({ session_id: 'ses_1', directory: '/repo' }, OC_EXPORT);
    const first = a._composePrompt('hello', 'ch-1', undefined);
    assert.match(first, /^CONTEXT\n\n---\n\nBefore you joined this workspace/);
    assert.match(first, /<previous_conversation>[\s\S]*OTTER-77[\s\S]*<\/previous_conversation>\n\n---\n\nhello$/);
    assert.equal(a._composePrompt('again', 'ch-1', 'ses_own'), 'again');
    a._channelSessions['ch-2'] = null;
    assert.equal(a._composePrompt('fresh', 'ch-2', undefined), 'CONTEXT\n\n---\n\nfresh');
  });

  it('starts fresh, and stops seeding, when the chat can no longer be exported', { skip }, () => {
    const a = adapterWith({ session_id: 'ses_1' }, OC_EXPORT, { exitCode: 1 });
    a._opencodeBinary = path.join(os.tmpdir(), 'no-such-opencode');
    assert.equal(a._composePrompt('hi', 'ch-1', undefined), 'CONTEXT\n\n---\n\nhi');
    assert.equal(a._seedSession, null);
  });
});

describe('ClaudeAdapter seed conversation', () => {
  function adapterWith(seed, cfg, workDir) {
    const adapter = new ClaudeAdapter({
      workspaceId: `ws-${Math.random().toString(36).slice(2)}`, channelName: 'general', token: 'tok',
      agentName: 'claude-test', workingDir: workDir, agentEnv: { CLAUDE_CONFIG_DIR: cfg }, seedSession: seed,
    });
    adapter._saveSessions = () => {};
    adapter._findClaudeBinary = () => process.execPath;
    adapter._channelSessions = {};
    return adapter;
  }
  function setup() {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-seed-'));
    const proj = path.join(cfg, 'projects', '-repo');
    fs.mkdirSync(proj, { recursive: true });
    const transcript = path.join(proj, 'seed-1.jsonl');
    fs.writeFileSync(transcript, '{"m":1}\n');
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-seed-wd-'));
    return { cfg, transcript, workDir };
  }

  it("forks the seed on a channel's first turn, copied under the agent's cwd", () => {
    const { cfg, transcript, workDir } = setup();
    const a = adapterWith({ session_id: 'seed-1', transcript }, cfg, workDir);
    const built = a._buildClaudeCmd('hi', 'ch-1');
    const i = built.cmd.indexOf('--resume');
    assert.deepEqual(built.cmd.slice(i, i + 3), ['--resume', 'seed-1', '--fork-session']);
    assert.equal(built.seeded, true);
    assert.ok(fs.existsSync(path.join(claudeProjectDir(cfg, workDir), 'seed-1.jsonl')));
  });

  it("resumes the channel's own session once it has one, and never forks a known channel again", () => {
    const { cfg, transcript, workDir } = setup();
    const a = adapterWith({ session_id: 'seed-1', transcript }, cfg, workDir);
    a._channelSessions['ch-1'] = 'own-9';
    let cmd = a._buildClaudeCmd('hi', 'ch-1').cmd;
    assert.equal(cmd[cmd.indexOf('--resume') + 1], 'own-9');
    assert.ok(!cmd.includes('--fork-session'));
    a._channelSessions['ch-2'] = null; // restarted: start fresh
    cmd = a._buildClaudeCmd('hi', 'ch-2').cmd;
    assert.ok(!cmd.includes('--resume'));
  });

  it('starts fresh on the retry without resume, and when the transcript is gone', () => {
    const { cfg, transcript, workDir } = setup();
    const a = adapterWith({ session_id: 'seed-1', transcript }, cfg, workDir);
    assert.ok(!a._buildClaudeCmd('hi', 'ch-1', { skipResume: true }).cmd.includes('--resume'));
    fs.rmSync(transcript);
    const built = a._buildClaudeCmd('hi', 'ch-3');
    assert.ok(!built.cmd.includes('--resume'));
    assert.equal(built.seeded, false);
    assert.equal(a._seedSession, null);
  });
});

describe('defaultAgentName', () => {
  it('is <type>-<host>, made unique', () => {
    assert.equal(defaultAgentName('claude', 'Raphaels-MacBook.local', new Set()), 'claude-raphaels-macbook');
    assert.equal(defaultAgentName('codex', 'box', new Set(['codex-box'])), 'codex-box-2');
    assert.equal(defaultAgentName('claude', 'mfvmds001-standard16-0', new Set()), 'claude-mfvmds001');
    assert.equal(defaultAgentName('claude', 'averyveryverylonghostname', new Set()), 'claude-averyveryverylon');
    assert.equal(defaultAgentName('claude', '', new Set()), 'claude');
  });
});

describe('agn join', () => {
  let cfgDir, config, redeemed, daemon, lines, enabled;

  function fakeConnector() {
    const registry = { getEntry: (t) => (['claude', 'codex', 'opencode'].includes(t) ? { name: t, label: t } : null) };
    return {
      _configDir: cfgDir,
      config,
      registry,
      workspace: { endpoint: 'https://workspace-endpoint.openagents.org' },
      redeemNodePairingCode: async (code, info) => {
        redeemed.push({ code, info });
        return { nodeId: 'node-1', workspaceId: 'ws-uuid', workspaceSlug: 'acme', workspaceName: 'Acme', ownerEmail: 'a@b.c', token: 'node-tok' };
      },
      addAgent: (a) => config.addAgent(a),
      connectWorkspace: (name, slug) => config.setAgentNetwork(name, slug),
      getDaemonPid: () => daemon.pid,
      stopDaemon: () => { daemon.stopped = true; daemon.pid = null; },
      startDaemon: (args) => { daemon.started = args; daemon.pid = 777; },
    };
  }
  const deps = () => ({
    ensureDurableInstall: () => ({ cliPath: '/lasting/agent-connector.js', nodeBin: '/node', copied: true }),
    autostart: { serviceEnv: autostart.serviceEnv, enable: (dir, opts) => { enabled = { dir, opts }; } },
    sleep: async () => {},
    gatherDeviceInfo: () => ({ nodeKey: 'nk', hostname: 'devbox', os: 'linux', deviceType: 'server' }),
  });
  const run = (env, flags = {}, code = 'ABCD-EFGH') =>
    join({ code, flags, connector: fakeConnector(), env, print: (l) => lines.push(l), deps: deps() });

  beforeEach(() => {
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agn-join-cfg-'));
    config = new Config(cfgDir);
    redeemed = []; daemon = { pid: null }; lines = []; enabled = null;
    fs.rmSync(path.join(tmpHome, '.openagents', 'node.json'), { force: true });
  });

  it('creates a Claude agent that forks this conversation, signed in through its CLI', async () => {
    const claudeCfg = path.join(tmpHome, '.claude');
    fs.mkdirSync(path.join(claudeCfg, 'projects', '-repo'), { recursive: true });
    const transcript = path.join(claudeCfg, 'projects', '-repo', 'abc-123.jsonl');
    fs.writeFileSync(transcript, '{}\n');

    const code = await run({ ...CLAUDE_HOST, PATH: '/usr/bin', HOME: tmpHome });
    assert.equal(code, 0, lines.join('\n'));
    assert.equal(redeemed.length, 1);
    const agent = config.getAgent('claude-devbox');
    assert.equal(agent.type, 'claude');
    assert.equal(agent.network, 'acme');
    assert.equal(agent.node_id, 'node-1');
    assert.deepEqual(agent.seed_session, { session_id: 'abc-123', transcript });
    assert.deepEqual(agent.env, { OPENAGENTS_AUTH_MODE: 'cli_login' });
    assert.equal(config.getNetworks()[0].token, 'node-tok');
    // Login service points at the lasting copy, and carries no host session vars.
    assert.equal(enabled.opts.cliPath, '/lasting/agent-connector.js');
    assert.ok(!('CLAUDECODE' in enabled.opts.env));
    assert.deepEqual(daemon.started, ['/lasting/agent-connector.js', 'up', '--foreground']);
    assert.match(lines.join('\n'), /Connected\. This agent is now 'claude-devbox' in the workspace 'Acme'/);
    assert.match(lines.join('\n'), /copy of this conversation/);
  });

  it('creates a Codex agent with its CODEX_HOME and the key it signs in with', async () => {
    const code = await run({ CODEX_SESSION_ID: 't-1', CODEX_HOME: '/c', OPENAI_API_KEY: 'sk-x' }, { name: 'builder' });
    assert.equal(code, 0, lines.join('\n'));
    const agent = config.getAgent('builder');
    assert.equal(agent.type, 'codex');
    assert.deepEqual(agent.env, { CODEX_HOME: '/c', OPENAI_API_KEY: 'sk-x' });
    assert.equal(agent.seed_session, undefined);
    assert.match(lines.join('\n'), /copied OPENAI_API_KEY/);
    assert.ok(!lines.join('\n').includes('sk-x'));
  });

  it("creates an OpenCode agent in the chat's project, on the chat's model, seeded with the chat", async () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-proj-'));
    const calls = [];
    const runOpencode = (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'session') return { status: 0, stdout: JSON.stringify([{ id: 'ses_old', directory: proj, updated: 1 }, { id: 'ses_1', directory: proj, updated: 2 }]) };
      if (args[0] === 'export') return { status: 0, stdout: JSON.stringify(OC_EXPORT) };
      return { status: 1 };
    };
    const code = await join({
      code: 'ABCD-EFGH', flags: {}, connector: fakeConnector(), env: { OPENCODE: '1', GOOGLE_CLOUD_PROJECT: 'p', VERTEX_LOCATION: 'global' },
      print: (l) => lines.push(l), deps: { ...deps(), runOpencode, cwd: proj },
    });
    assert.equal(code, 0, lines.join('\n'));
    const agent = config.getAgent('opencode-devbox');
    assert.equal(agent.type, 'opencode');
    assert.equal(agent.path, proj);
    assert.deepEqual(agent.seed_session, { session_id: 'ses_1', directory: proj });
    assert.deepEqual(agent.env, {
      GOOGLE_CLOUD_PROJECT: 'p', VERTEX_LOCATION: 'global', OPENAGENTS_AUTH_MODE: 'cli_login',
      OPENCODE_MODEL: 'google-vertex-anthropic/claude-haiku-5-5@default',
    });
    assert.deepEqual(calls, ['session list --format json', 'export ses_1']);
    assert.match(lines.join('\n'), /transcript of this conversation/);
    assert.match(lines.join('\n'), /Model: google-vertex-anthropic\/claude-haiku-5-5@default/);
  });

  it('creates an OpenCode agent that says how to set a model when no chat is found', async () => {
    const code = await join({
      code: 'ABCD-EFGH', flags: {}, connector: fakeConnector(), env: { OPENCODE: '1' },
      print: (l) => lines.push(l), deps: { ...deps(), runOpencode: () => ({ status: 1 }), cwd: tmpHome },
    });
    assert.equal(code, 0);
    assert.equal(config.getAgent('opencode-devbox').seed_session, undefined);
    assert.match(lines.join('\n'), /Model: none found/);
  });

  it('refuses outside an agent without using the code', async () => {
    assert.equal(await run({ PATH: '/usr/bin' }), 1);
    assert.equal(redeemed.length, 0);
    assert.match(lines.join('\n'), /--type <type>/);
  });

  it("refuses inside Codex's sandbox without using the code", async () => {
    assert.equal(await run({ CODEX_SESSION_ID: 't', CODEX_SANDBOX: 'seatbelt' }), 1);
    assert.equal(redeemed.length, 0);
    assert.match(lines.join('\n'), /still valid/);
  });

  it('refuses a taken name without using the code', async () => {
    config.addAgent({ name: 'builder', type: 'codex' });
    assert.equal(await run({ CODEX_SESSION_ID: 't' }, { name: 'builder' }), 1);
    assert.equal(redeemed.length, 0);
  });

  it('restarts a running daemon and honours --no-autostart', async () => {
    daemon.pid = 555;
    assert.equal(await run({ CODEX_SESSION_ID: 't' }, { autostart: false }), 0);
    assert.equal(daemon.stopped, true);
    assert.equal(enabled, null);
    assert.equal(daemon.pid, 777);
    assert.match(lines.join('\n'), /Start at login: off \(--no-autostart\)/);
  });
});

describe('ensureDurableInstall', () => {
  it('copies the package and its dependencies out of the npx cache, with shims', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agn-durable-'));
    const npxModules = path.join(home, '.npm', '_npx', 'h1', 'node_modules');
    const pkg = path.join(npxModules, '@openagents-org', 'agent-launcher');
    fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version: '1.2.3', dependencies: { ws: '^8' } }));
    fs.writeFileSync(path.join(pkg, 'bin', 'agent-connector.js'), '');
    fs.mkdirSync(path.join(npxModules, 'ws'), { recursive: true });
    fs.writeFileSync(path.join(npxModules, 'ws', 'package.json'), JSON.stringify({ version: '8.1.0' }));

    const r = ensureDurableInstall({ pkgRoot: pkg, home, nodeBin: '/usr/bin/node' });
    const modules = path.join(home, '.openagents', 'nodejs', 'node_modules');
    assert.equal(r.cliPath, path.join(modules, '@openagents-org', 'agent-launcher', 'bin', 'agent-connector.js'));
    assert.equal(r.copied, true);
    assert.ok(fs.existsSync(path.join(modules, 'ws', 'package.json')));
    const manifest = JSON.parse(fs.readFileSync(path.join(home, '.openagents', 'nodejs', 'package.json'), 'utf-8'));
    assert.equal(manifest.dependencies['@openagents-org/agent-launcher'], '1.2.3');
    if (process.platform !== 'win32') {
      assert.match(fs.readFileSync(path.join(modules, '.bin', 'agn'), 'utf-8'), /exec "\/usr\/bin\/node"/);
    }
    // Same version again: nothing to copy.
    assert.equal(ensureDurableInstall({ pkgRoot: pkg, home, nodeBin: '/usr/bin/node' }).copied, false);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('uses the running package as it is when not under npx', () => {
    const r = ensureDurableInstall({ pkgRoot: '/opt/agn', home: tmpHome });
    assert.equal(r.cliPath, path.join('/opt/agn', 'bin', 'agent-connector.js'));
    assert.equal(r.copied, false);
  });

  it('compares versions numerically', () => {
    assert.equal(compareVersions('0.2.10', '0.2.9'), 1);
    assert.equal(compareVersions('0.2.9', '0.2.9'), 0);
    assert.equal(compareVersions('0.2.9', '0.3.0'), -1);
  });
});

describe('autostart service environment', () => {
  it('keeps PATH and proxies, drops npx entries and proxies with a password', () => {
    const abs = (...p) => path.resolve(path.sep, ...p);
    const { env, skipped } = autostart.serviceEnv({
      PATH: [abs('h', '.npm', '_npx', 'a', 'node_modules', '.bin'), abs('usr', 'bin'), 'rel', abs('h', '.local', 'bin')].join(path.delimiter),
      HTTPS_PROXY: 'http://u:p@proxy:1', HTTP_PROXY: 'http://proxy:2', SECRET_TOKEN: 'x',
    });
    assert.equal(env.PATH, [abs('usr', 'bin'), abs('h', '.local', 'bin')].join(path.delimiter));
    assert.equal(env.HTTP_PROXY, 'http://proxy:2');
    assert.ok(!('HTTPS_PROXY' in env) && !('SECRET_TOKEN' in env));
    assert.deepEqual(skipped, ['HTTPS_PROXY']);
  });
  it('writes the variables into the systemd unit and the plist', () => {
    const unit = autostart.renderUnit('/n/node', '/a b/cli.js', { PATH: '/usr/bin', X: '50%' });
    assert.match(unit, /ExecStart="\/n\/node" "\/a b\/cli.js" up --foreground/);
    assert.match(unit, /Environment="X=50%%"/);
    const plist = autostart.renderPlist('/n/node', '/a&b/cli.js', '/cfg', { PATH: '/usr/bin' });
    assert.match(plist, /<string>\/a&amp;b\/cli.js<\/string>/);
    assert.match(plist, /<key>PATH<\/key>\n\s+<string>\/usr\/bin<\/string>/);
  });
});
