'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AgentConnector } = require('../src/index');
const { Daemon } = require('../src/daemon');

const HOME_KEY = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
const MODULE = require.resolve('../src/adapters/openclaw');
const deepseek = { LLM_API_KEY: 'sk-deepseek-fixture', LLM_BASE_URL: 'https://api.deepseek.com', LLM_MODEL: 'deepseek-flash' };
const glm = { LLM_API_KEY: 'sk-glm-fixture', LLM_BASE_URL: 'https://gateway.example/v1', LLM_MODEL: 'glm-5.3-flash' };
let home, savedHome, connector, daemon, OpenClaw, FakeCliAdapter;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const globalFile = () => path.join(home, '.openclaw', 'openclaw.json');
const globalConfig = { agents: { defaults: { model: { primary: 'custom/personal-model' } } }, personalSetting: 'keep' };

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-openclaw-isolation-'));
  savedHome = process.env[HOME_KEY];
  process.env[HOME_KEY] = home;
  delete require.cache[MODULE];
  OpenClaw = require(MODULE);
  connector = new AgentConnector({ configDir: path.join(home, '.openagents') });
  daemon = new Daemon(connector.config, connector.env, connector.registry);
  fs.mkdirSync(path.dirname(globalFile()), { recursive: true });
  fs.writeFileSync(globalFile(), JSON.stringify(globalConfig));
  const cli = path.join(home, 'fake-openclaw.mjs');
  fs.writeFileSync(cli, `
    import fs from 'node:fs';
    import path from 'node:path';
    const state = process.env.OPENCLAW_STATE_DIR || path.join(process.env.${HOME_KEY}, '.openclaw');
    const configPath = process.env.OPENCLAW_CONFIG_PATH || path.join(state, 'openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const agentId = process.argv[process.argv.indexOf('--agent') + 1];
    if ((agentId !== 'main' || Object.keys(config.agents.entries || {}).length) && !Object.hasOwn(config.agents.entries || {}, agentId)) {
      throw new Error('Unknown agent id: ' + agentId);
    }
    const model = config.agents.defaults.model.primary;
    const provider = config.models?.providers?.[model.split('/')[0]];
    const storedKeyFile = process.env.OPENCLAW_AGENT_DIR && path.join(process.env.OPENCLAW_AGENT_DIR, 'fixture-key.txt');
    const storedKey = storedKeyFile && fs.existsSync(storedKeyFile) ? fs.readFileSync(storedKeyFile, 'utf8') : '';
    const text = JSON.stringify({ state, configPath, model,
      key: provider?.apiKey || storedKey || process.env.OPENAI_API_KEY,
      workspace: config.agents.defaults.workspace,
      session: process.argv[process.argv.indexOf('--session-id') + 1] });
    console.log(JSON.stringify({payloads:[{text}]}));
  `);
  FakeCliAdapter = class extends OpenClaw {
    _findOpenclawBinary() { return cli; }
  };
});

afterEach(() => {
  if (savedHome === undefined) delete process.env[HOME_KEY];
  else process.env[HOME_KEY] = savedHome;
  delete require.cache[MODULE];
  const target = path.resolve(home);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert.ok(path.basename(target).startsWith('ac-openclaw-isolation-'));
  fs.rmSync(target, { recursive: true, force: true });
});

function runtimeEnv(name) {
  return daemon._buildAgentEnv(connector.config.getAgent(name));
}

function adapter(name, extra = {}) {
  return new FakeCliAdapter({ workspaceId: 'workspace-1', channelName: 'general', token: 'test-token',
    agentName: name, agentType: 'openclaw', endpoint: 'http://127.0.0.1:1', workingDir: home,
    configDir: connector.config.configDir, agentEnv: runtimeEnv(name), logSink: () => {}, ...extra });
}

async function run(instance) {
  return JSON.parse(await instance._runCliAgent('show runtime configuration', 'same-channel'));
}

describe('OpenClaw launcher instance isolation', () => {
  it('saving the second agent leaves the first agent key and model usable', async () => {
    connector.addAgent({ name: 'deepseek', type: 'openclaw', env: deepseek });
    const first = adapter('deepseek');
    const before = await run(first);
    connector.addAgent({ name: 'glm', type: 'openclaw', env: glm });
    connector.saveAgentInstanceEnv('glm', { LLM_API_KEY: 'sk-glm-updated' });
    const second = await run(adapter('glm'));
    const after = await run(first);
    assert.equal(after.model, 'custom/deepseek-flash');
    assert.equal(after.key, 'sk-deepseek-fixture');
    assert.equal(second.model, 'custom/glm-5.3-flash');
    assert.equal(second.key, 'sk-glm-updated');
    assert.equal(before.state, after.state);
    assert.notEqual(after.state, second.state);
    assert.notEqual(after.workspace, second.workspace);
    assert.deepEqual(readJson(globalFile()), globalConfig);
    connector.saveAgentInstanceEnv('deepseek', { LLM_MODEL: 'deepseek-next' });
    assert.equal((await run(first)).model, 'custom/deepseek-next');
    assert.equal((await run(adapter('glm'))).model, 'custom/glm-5.3-flash');
  });

  it('repairs already-saved agents at startup without copying shared sessions or auth', async () => {
    connector.config.addAgent({ name: 'old-dp', type: 'openclaw', env: deepseek });
    connector.config.addAgent({ name: 'old-glm', type: 'openclaw', env: glm });
    const legacy = path.join(home, '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify({ profiles: { 'custom:manual': { type: 'token', provider: 'custom', token: 'sk-shared' } } }));
    const first = await run(adapter('old-dp'));
    const second = await run(adapter('old-glm'));
    assert.equal(first.model, 'custom/deepseek-flash');
    assert.equal(second.model, 'custom/glm-5.3-flash');
    assert.equal(first.key, 'sk-deepseek-fixture');
    assert.equal(second.key, 'sk-glm-fixture');
    assert.ok(fs.existsSync(legacy), 'private startup must not retire shared credentials');
    assert.deepEqual(readJson(globalFile()), globalConfig);
    assert.ok(!fs.existsSync(path.join(first.state, 'agents', 'main', 'agent', 'auth-profiles.json')));
  });

  it('derives safe distinct stores even for names that alias on Windows', () => {
    const names = ['Agent', 'agent', '../agent', '..\\agent', '中文', '???'];
    const stores = names.map(name => {
      connector.config.addAgent({ name, type: 'openclaw', env: deepseek });
      const env = runtimeEnv(name);
      assert.ok(env.OPENCLAW_STATE_DIR, 'each instance needs its own state directory');
      const relative = path.relative(connector.config.configDir, env.OPENCLAW_STATE_DIR);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
      assert.equal(path.dirname(env.OPENCLAW_CONFIG_PATH), env.OPENCLAW_STATE_DIR);
      return env.OPENCLAW_STATE_DIR.toLowerCase();
    });
    assert.equal(new Set(stores).size, names.length);
  });

  it('keeps standard-provider keys in each child environment', async () => {
    connector.addAgent({ name: 'oa-first', type: 'openclaw', env: { LLM_API_KEY: 'sk-first', LLM_BASE_URL: 'https://api.openai.com/v1', LLM_MODEL: 'first-model' } });
    connector.addAgent({ name: 'oa-second', type: 'openclaw', env: { LLM_API_KEY: 'sk-second', LLM_BASE_URL: 'https://api.openai.com/v1', LLM_MODEL: 'second-model' } });
    assert.equal((await run(adapter('oa-first'))).key, 'sk-first');
    assert.equal((await run(adapter('oa-first'))).model, 'openai/first-model');
    assert.equal((await run(adapter('oa-second'))).key, 'sk-second');
    assert.equal((await run(adapter('oa-second'))).model, 'openai/second-model');
  });

  it('keeps an explicitly selected native agent runnable in its private config', async () => {
    connector.config.addAgent({ name: 'research-dp', type: 'openclaw', env: deepseek });
    const instance = adapter('research-dp', { openclawAgentId: 'research' });
    assert.equal((await run(instance)).model, 'custom/deepseek-flash');
    connector.saveAgentInstanceEnv('research-dp', { LLM_MODEL: 'deepseek-next' });
    assert.equal((await run(instance)).model, 'custom/deepseek-next');
    assert.equal((await run(adapter('research-dp', { openclawAgentId: 'main' }))).model, 'custom/deepseek-next');
    assert.deepEqual(readJson(globalFile()), globalConfig);
  });

  it('writes no agents.entries for the default agent, which OpenClaw 2026.7 and older refuse to load', async () => {
    connector.addAgent({ name: 'plain-dp', type: 'openclaw', env: deepseek });
    const result = await run(adapter('plain-dp'));
    assert.equal(result.model, 'custom/deepseek-flash');
    assert.equal(Object.hasOwn(readJson(result.configPath).agents, 'entries'), false);
  });

  it('does not let an inherited native auth directory override saved provider keys', async () => {
    const sharedAuth = path.join(home, 'shared-native-auth');
    fs.mkdirSync(sharedAuth);
    fs.writeFileSync(path.join(sharedAuth, 'fixture-key.txt'), 'sk-shared-profile');
    const saved = process.env.OPENCLAW_AGENT_DIR;
    process.env.OPENCLAW_AGENT_DIR = sharedAuth;
    try {
      connector.addAgent({ name: 'oa-a', type: 'openclaw', env: { LLM_API_KEY: 'sk-instance-a', LLM_MODEL: 'model-a', LLM_BASE_URL: 'https://api.openai.com/v1' } });
      connector.addAgent({ name: 'oa-b', type: 'openclaw', env: { LLM_API_KEY: 'sk-instance-b', LLM_MODEL: 'model-b', LLM_BASE_URL: 'https://api.openai.com/v1' } });
      assert.equal((await run(adapter('oa-a'))).key, 'sk-instance-a');
      assert.equal((await run(adapter('oa-b'))).key, 'sk-instance-b');
      assert.equal(fs.readFileSync(path.join(sharedAuth, 'fixture-key.txt'), 'utf8'), 'sk-shared-profile');
    } finally {
      if (saved === undefined) delete process.env.OPENCLAW_AGENT_DIR;
      else process.env.OPENCLAW_AGENT_DIR = saved;
    }
  });

  it('uses the saved config when the connector root is relative and CLI cwd differs', async () => {
    const relativeRoot = path.relative(process.cwd(), path.join(home, 'relative-connector'));
    connector = new AgentConnector({ configDir: relativeRoot });
    daemon = new Daemon(connector.config, connector.env, connector.registry);
    connector.addAgent({ name: 'relative-dp', type: 'openclaw', env: deepseek });
    const result = await run(adapter('relative-dp'));
    assert.equal(result.model, 'custom/deepseek-flash');
    assert.equal(result.key, 'sk-deepseek-fixture');
    assert.ok(path.isAbsolute(result.state));
    assert.ok(path.isAbsolute(result.configPath));
    assert.ok(path.isAbsolute(result.workspace));
  });

  it('workspace configuration edits persist only on the targeted OpenClaw agent', async () => {
    connector.config.addAgent({ name: 'dp', type: 'openclaw', env: deepseek });
    connector.config.addAgent({ name: 'glm', type: 'openclaw', env: glm });
    const commands = [];
    daemon._runAgn = async args => { commands.push(args); return { code: 0 }; };
    await daemon._applyConfigMap('openclaw', { LLM_API_KEY: 'sk-edited', LLM_MODEL: 'glm-next' }, 'glm');
    assert.equal(connector.getAgentInstanceEnv('glm').LLM_API_KEY, 'sk-edited');
    assert.equal(connector.getAgentInstanceEnv('glm').LLM_MODEL, 'glm-next');
    assert.equal(connector.getAgentInstanceEnv('dp').LLM_API_KEY, 'sk-deepseek-fixture');
    assert.deepEqual(connector.getAgentEnv('openclaw'), {});
    assert.deepEqual(commands, []);
  });

  for (const mode of ['fields', 'config-and-move', 'move-only']) {
    const move = mode !== 'fields';
    it(`workspace reconfiguration keeps OpenClaw credentials private${mode === 'move-only' ? ' when moving without replacement keys' : (move ? ' when moving folders' : '')}`, async () => {
      connector.config.addAgent({ name: 'dp', type: 'openclaw', env: deepseek, path: home });
      connector.config.addAgent({ name: 'glm', type: 'openclaw', env: glm });
      connector.config.setAgentNetwork('dp', 'ws1');
      const commands = [];
      daemon._runAgn = async args => {
        commands.push(args);
        if (args[0] === 'remove') connector.config.removeAgent(args[1]);
        if (args[0] === 'create') connector.config.addAgent({ name: args[1], type: 'openclaw', path: args[args.indexOf('--path') + 1] });
        if (args[0] === 'connect') connector.config.setAgentNetwork(args[1], 'ws1');
        return { code: 0, stdout: '' };
      };
      daemon.restartAgent = async () => {};
      daemon._probeAgent = async () => ({ ok: true });
      daemon._askCliModels = () => {};
      let reported;
      daemon._nodeClients.set('node1', { nodeCommandResult: async (_id, _token, result) => { reported = result; } });
      const settings = { LLM_API_KEY: 'sk-updated-dp', LLM_MODEL: 'deepseek-next', LLM_BASE_URL: 'https://dp.example/v1' };
      const input = mode === 'move-only'
        ? { workingDir: path.join(home, 'moved'), currentWorkingDir: home }
        : move
        ? { config: settings, workingDir: path.join(home, 'moved'), currentWorkingDir: home }
        : { apiKey: settings.LLM_API_KEY, model: settings.LLM_MODEL, baseUrl: settings.LLM_BASE_URL };
      await daemon._runNodeCommand(
        { node_id: 'node1', workspace_id: 'workspace-1', workspace_slug: 'ws1', token: 'fixture' },
        { commandId: 'configure-dp', action: 'configure_agent', args: { name: 'dp', type: 'openclaw', ...input } },
      );
      assert.equal(reported.ok, true, reported.message);
      assert.equal(commands.some(args => args[0] === 'env'), false, 'OpenClaw must not update the type-wide native config');
      assert.equal(connector.getAgentInstanceEnv('dp').LLM_API_KEY, mode === 'move-only' ? 'sk-deepseek-fixture' : 'sk-updated-dp');
      assert.equal(connector.getAgentInstanceEnv('dp').LLM_MODEL, mode === 'move-only' ? 'deepseek-flash' : 'deepseek-next');
      assert.equal(connector.getAgentInstanceEnv('glm').LLM_API_KEY, 'sk-glm-fixture');
      assert.deepEqual(connector.getAgentEnv('openclaw'), {});
    });
  }
});
