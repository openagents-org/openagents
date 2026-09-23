'use strict';

/**
 * Codex on a third-party endpoint.
 *
 * Any base URL other than api.openai.com used to force Direct mode, a chat
 * completion with no tools, even when the endpoint served /responses. The
 * workspace prompt still asked for curl, skills and the decision log, so a
 * reasoning model (gpt-oss-120b) planned a tool call and ended with reasoning
 * only, or posted the plan as its reply. In CLI mode the adapter passed the
 * endpoint and key as OPENAI_BASE_URL / OPENAI_API_KEY, which codex-cli 0.154
 * ignores: it called api.openai.com with no key.
 * Synthetic fixtures only: a stubbed spawn and a local HTTP server.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const CodexAdapter = require('../src/adapters/codex');

function fakeAdapter(overrides = {}) {
  const adapter = Object.create(CodexAdapter.prototype);
  const sent = [];
  Object.assign(adapter, {
    channelName: 'general',
    workspaceId: 'ws1',
    token: 'agent-token-1',
    endpoint: 'https://ws.example',
    agentEnv: {},
    workingDir: '',
    _codexBin: 'codex',
    _directApiKey: 'sk-relay-key-123456',
    _directBaseUrl: '',
    _directModel: 'openai-gpt-oss-120b',
    _directMode: true,
    _useCliMode: false,
    _responsesProbe: { supported: null, checkedAt: 0 },
    _channelThreads: {},
    _channelProcesses: {},
    _conversationHistory: [],
    sent,
    logs: [],
    _log(line) { this.logs.push(line); },
    _saveSessions() {},
    _autoTitleChannel: async () => {},
    _buildSystemContext: () => 'SYSTEM',
    sendStatus: async () => {},
    sendResponse: async (channel, content) => { sent.push({ kind: 'response', channel, content }); },
    sendError: async (channel, content) => { sent.push({ kind: 'error', channel, content }); },
  }, overrides);
  return adapter;
}

describe('Codex — picking CLI or Direct mode for a third-party endpoint', () => {
  let server;
  let baseUrl;
  let status = 404;
  const probes = [];

  before(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        probes.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end('{"detail":"nope"}');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  function run(adapter) {
    const spawned = [];
    const direct = [];
    adapter._spawnCodex = async (cmd, env) => { spawned.push({ cmd, env }); return { responseText: 'cli answer', exitCode: 0 }; };
    adapter._callCompletionApi = async (m) => { direct.push(m); return 'direct answer'; };
    return { spawned, direct };
  }

  it('asks <base>/responses with the key and an empty body, which runs no model', async () => {
    probes.length = 0;
    status = 404;
    const adapter = fakeAdapter({ _directBaseUrl: baseUrl });
    run(adapter);
    await adapter._handleMessage({ sessionId: 'general', content: 'hi' });
    assert.deepStrictEqual(probes, [{
      method: 'POST', url: '/v1/responses', auth: 'Bearer sk-relay-key-123456', body: '{}',
    }]);
  });

  it('stays in Direct mode on a 404 and does not ask again', async () => {
    probes.length = 0;
    status = 404;
    const adapter = fakeAdapter({ _directBaseUrl: baseUrl });
    const { spawned, direct } = run(adapter);
    await adapter._handleMessage({ sessionId: 'general', content: 'one' });
    await adapter._handleMessage({ sessionId: 'general', content: 'two' });
    assert.strictEqual(probes.length, 1);
    assert.strictEqual(spawned.length, 0);
    assert.strictEqual(direct.length, 2);
    assert.strictEqual(adapter._responsesProbe.supported, false);
  });

  for (const code of [400, 401, 422]) {
    it(`switches to the CLI when /responses answers ${code}`, async () => {
      probes.length = 0;
      status = code;
      const adapter = fakeAdapter({ _directBaseUrl: baseUrl });
      const { spawned, direct } = run(adapter);
      await adapter._handleMessage({ sessionId: 'general', content: 'one' });
      await adapter._handleMessage({ sessionId: 'general', content: 'two' });
      assert.strictEqual(probes.length, 1);
      assert.strictEqual(direct.length, 0);
      assert.strictEqual(spawned.length, 2);
      assert.ok(adapter._useCliMode && !adapter._directMode);
      assert.deepStrictEqual(adapter.sent.map((s) => s.content), ['cli answer', 'cli answer']);
    });
  }

  it('uses Direct mode for the turn when the endpoint is unreachable, and asks again later', async () => {
    const adapter = fakeAdapter({ _directBaseUrl: 'http://127.0.0.1:1/v1' });
    const { spawned, direct } = run(adapter);
    await adapter._handleMessage({ sessionId: 'general', content: 'one' });
    assert.strictEqual(direct.length, 1);
    assert.strictEqual(spawned.length, 0);
    assert.strictEqual(adapter._responsesProbe.supported, null, 'no answer is not a verdict');

    // Inside the retry window nothing is sent; past it the probe runs again.
    probes.length = 0;
    status = 422;
    adapter._directBaseUrl = baseUrl;
    await adapter._handleMessage({ sessionId: 'general', content: 'two' });
    assert.strictEqual(probes.length, 0);
    adapter._responsesProbe.checkedAt = Date.now() - 6 * 60 * 1000;
    await adapter._handleMessage({ sessionId: 'general', content: 'three' });
    assert.strictEqual(probes.length, 1);
    assert.strictEqual(spawned.length, 1);
  });

  it('never probes when the mode was settled at startup', async () => {
    probes.length = 0;
    const adapter = fakeAdapter({
      _directBaseUrl: baseUrl, _responsesProbe: null, _directMode: false, _useCliMode: true,
    });
    run(adapter);
    await adapter._handleMessage({ sessionId: 'general', content: 'hi' });
    assert.strictEqual(probes.length, 0);
  });
});

describe('Codex CLI mode — pointing the CLI at the configured endpoint', () => {
  async function spawnWith(overrides) {
    let invocation;
    const adapter = fakeAdapter({
      _directMode: false,
      _useCliMode: true,
      _responsesProbe: null,
      workingDir: '/tmp/agent-work',
      _channelThreads: { general: 'thread-1' },
      _spawnCodex: async (cmd, env) => { invocation = { cmd, env }; return { responseText: 'ok', exitCode: 0 }; },
      ...overrides,
    });
    await adapter._handleMessage({ sessionId: 'general', content: 'hi' });
    return invocation;
  }

  const overridesOf = (cmd) => cmd.flatMap((a, i) => (cmd[i - 1] === '-c' ? [a] : []));

  it('passes a model provider, since codex-cli 0.154 ignores OPENAI_BASE_URL', async () => {
    const { cmd, env } = await spawnWith({ _directBaseUrl: 'https://relay.example/v1' });
    assert.deepStrictEqual(overridesOf(cmd), [
      'model_provider=openagents_endpoint',
      'model_providers.openagents_endpoint.name=openagents_endpoint',
      'model_providers.openagents_endpoint.base_url=https://relay.example/v1',
      'model_providers.openagents_endpoint.env_key=OPENAI_API_KEY',
    ]);
    assert.strictEqual(env.OPENAI_API_KEY, 'sk-relay-key-123456');
    assert.strictEqual(env.OPENAI_BASE_URL, undefined);
  });

  it('keeps the key off the command line', async () => {
    const { cmd } = await spawnWith({ _directBaseUrl: 'https://relay.example/v1' });
    assert.ok(!cmd.join(' ').includes('sk-relay-key'));
  });

  it('sends an OpenAI key to api.openai.com the same way, as the CLI ignores OPENAI_API_KEY too', async () => {
    const { cmd } = await spawnWith({ _directBaseUrl: '' });
    assert.ok(overridesOf(cmd).includes('model_providers.openagents_endpoint.base_url=https://api.openai.com/v1'));
  });

  it('leaves subscription auth (no key) to the CLI login', async () => {
    const { cmd } = await spawnWith({ _directApiKey: '', _directBaseUrl: '' });
    assert.ok(!cmd.includes('-c'));
  });

  it('puts the overrides before resume, which accepts them', async () => {
    const { cmd } = await spawnWith({ _directBaseUrl: 'https://relay.example/v1' });
    assert.deepStrictEqual(cmd.slice(-2), ['resume', 'thread-1']);
    assert.ok(cmd.lastIndexOf('-c') < cmd.indexOf('resume'));
  });
});

describe('Codex Direct mode — the prompt admits there are no tools', () => {
  function realPrompt(overrides = {}) {
    const adapter = fakeAdapter({
      agentName: 'codex',
      _mode: 'execute',
      disabledModules: new Set(),
      modelLabel: () => 'openai-gpt-oss-120b',
      pinnedPromptOpts: () => ({}),
      _buildInstalledSkillsSection: () => '## Installed Skills\n- **hypit**',
      ...overrides,
    });
    delete adapter._buildSystemContext; // use the real one
    return adapter;
  }

  it('drops the skills list and ends with the no-tools notice', () => {
    const text = realPrompt()._buildSystemContext('general', { tools: false });
    assert.ok(!text.includes('## Installed Skills'));
    assert.ok(text.trimEnd().endsWith('Responses API, or another agent in this workspace.'));
    assert.ok(text.includes('## This run has no tools'));
  });

  it('keeps the skills list, and no notice, when the CLI runs', () => {
    const text = realPrompt()._buildSystemContext('general');
    assert.ok(text.includes('## Installed Skills'));
    assert.ok(!text.includes('## This run has no tools'));
  });

  it('is what the completions request sends', async () => {
    const seen = [];
    let captured;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        captured = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const adapter = fakeAdapter({
        _directBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        _buildSystemContext: (channel, opts) => { seen.push(opts); return 'SYSTEM'; },
      });
      assert.strictEqual(await adapter._callCompletionApi('hi', 'general'), 'hello');
      assert.deepStrictEqual(seen, [{ tools: false }]);
      assert.strictEqual(captured.messages[0].content, 'SYSTEM');
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});
