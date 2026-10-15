'use strict';

/**
 * Optional regression against a real MiMo Code CLI: set MIMO_CODE_TEST_CLI to
 * a `mimo` binary. No external endpoint or paid key is used — the model is a
 * local HTTP server.
 *
 * What it guards is the routing: a user whose own MiMo setup names other
 * providers, other keys and another base URL still has every request of an
 * agent run sent to the agent's endpoint with the agent's key. Before the run
 * was pinned to one provider, a `small_model` in the user's config received
 * the first message of each session under the user's key.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const MiMoCodeAdapter = require('../src/adapters/mimo-code');

const cli = process.env.MIMO_CODE_TEST_CLI;

/**
 * A local model. Asked to DELEGATE, the first answer is a call to MiMo's
 * `actor` tool, which runs a subagent — the subagent picks its model from the
 * user's `agent.general.model` unless the run is pinned to one provider.
 * Everything else is answered PONG.
 */
function startModel() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let json = {};
      try { json = JSON.parse(body); } catch {}
      const messages = json.messages || [];
      const text = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''));
      requests.push({
        url: req.url,
        authorization: req.headers.authorization || '',
        model: json.model,
        tools: (json.tools || []).map((t) => (t.function && t.function.name) || t.name),
        headers: req.headers,
      });
      const delegate = messages.some((m) => m.role === 'user' && text(m).includes('DELEGATE'))
        && !messages.some((m) => m.role === 'tool');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (delta, finish) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: json.model, choices: [{ index: 0, delta, finish_reason: finish || null }] })}\n\n`;
      res.write(chunk({ role: 'assistant', content: '' }));
      if (delegate) {
        const args = { operation: { action: 'run', subagent_type: 'general', description: 'Say hi', prompt: 'Say hi.' } };
        res.write(chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'actor', arguments: JSON.stringify(args) } }] }));
        res.write(chunk({}, 'tool_calls'));
      } else {
        res.write(chunk({ content: 'PONG' }));
        res.write(chunk({}, 'stop'));
      }
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, requests })));
}

/** A home whose MiMo setup would send requests elsewhere if it were consulted. */
function conflictingHome(dir, base) {
  const home = path.join(dir, 'home');
  const config = path.join(home, '.config', 'mimocode');
  const data = path.join(home, '.local', 'share', 'mimocode');
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(config, 'mimocode.json'), JSON.stringify({
    model: 'saved/m1',
    small_model: 'saved/m1',
    agent: { title: { model: 'saved/m1' }, build: { model: 'saved/m1' }, general: { model: 'saved/m1' }, explore: { model: 'saved/m1' } },
    model_groups: { lite: 'saved/m1', standard: 'saved/m1' },
    provider: {
      saved: { npm: '@ai-sdk/openai-compatible', options: { baseURL: `${base}/saved/v1`, apiKey: 'saved-key' }, models: { m1: {} } },
      openagents: { npm: '@ai-sdk/openai-compatible', options: { baseURL: `${base}/saved/v1`, apiKey: 'same-id-key' }, models: { 'agent-model': { id: 'renamed-by-user' } } },
    },
  }));
  fs.writeFileSync(path.join(data, 'auth.json'), JSON.stringify({
    xiaomi: { type: 'api', key: 'signed-in-key', metadata: { uid: '1', base_url: `${base}/saved/v1` } },
    openagents: { type: 'api', key: 'stored-key' },
  }));
  return home;
}

/**
 * Run one turn through the adapter and the real CLI, in a scratch home with
 * conflictingHome's setup. Returns the reply and every request the model saw.
 */
async function runTurn(prompt, { provider = 'openagents' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-mimo-cli-'));
  const savedHome = process.env.HOME;
  const { server, requests } = await startModel();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const home = conflictingHome(dir, base);
    const work = path.join(dir, 'project');
    fs.mkdirSync(work);
    const agentEnv = {
      ...process.env,
      HOME: home, USERPROFILE: home,
      XIAOMI_API_KEY: 'env-xiaomi-key', DASHSCOPE_API_KEY: 'env-dashscope-key', OPENAI_API_KEY: 'env-openai-key',
      LLM_API_KEY: 'agent-key', LLM_BASE_URL: `${base}/agent/v1`, LLM_MODEL: 'agent-model',
    };
    for (const k of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'MIMOCODE_HOME', 'MIMOCODE_CONFIG']) delete agentEnv[k];
    // The adapter keeps its own files (sessions, the briefing) under the
    // daemon's home; point that at the scratch dir too.
    process.env.HOME = home;
    const adapter = new MiMoCodeAdapter({
      workspaceId: 'mimo-cli-test', channelName: 'thread', token: 'unused',
      agentName: 'mimo-cli-test', agentType: 'mimo-code', workingDir: work, endpoint: 'http://127.0.0.1:9',
      agentEnv,
    });
    adapter._log = () => {};
    adapter._opencodeBinary = cli;
    adapter._findOpencodeBinary = () => cli;
    adapter.getBrowserEnabled = async () => false;
    adapter.sendStatus = async () => {};
    adapter.sendThinking = async () => {};
    if (provider === 'xiaomi') {
      // MiMo's built-in provider, as a MiMo base URL selects it, pointed here.
      const route = adapter._route();
      adapter._route = () => ({ ...route, providerId: 'xiaomi', modelRef: 'xiaomi/agent-model' });
    }
    const reply = await adapter._runOpencode(prompt, 'thread');
    return { reply, requests, files: fs.readdirSync(work) };
  } finally {
    process.env.HOME = savedHome;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertOnlyAgentEndpoint(requests) {
  assert.ok(requests.length >= 1);
  for (const r of requests) {
    assert.equal(r.url, '/agent/v1/chat/completions');
    assert.equal(r.authorization, 'Bearer agent-key');
    assert.equal(r.model, 'agent-model');
    assert.equal(r.headers['x-saved'], undefined);
  }
}

const skip = !cli && 'Set MIMO_CODE_TEST_CLI to a MiMo Code executable';

describe('MiMo Code CLI — a run goes only where the agent says', () => {
  for (const provider of ['openagents', 'xiaomi']) {
    it(`sends every request to the agent endpoint with the agent key (${provider} provider)`, { skip, timeout: 120000 }, async () => {
      const { reply, requests, files } = await runTurn('Reply PONG.', { provider });
      assert.equal(reply, 'PONG');
      assertOnlyAgentEndpoint(requests);
      assert.equal(requests.length, 1, 'no second request to title the session');
      assert.ok(requests[0].tools.some((t) => t.startsWith('openagents-workspace_workspace_')), 'workspace MCP tools offered');
      assert.equal(requests[0].tools.includes('cron'), false, 'scheduler off');
      assert.deepEqual(files, [], 'nothing written into the project');
    });
  }

  it("keeps a subagent on the agent's endpoint despite the user's agent.general.model", { skip, timeout: 120000 }, async () => {
    const { reply, requests } = await runTurn('DELEGATE this to a subagent, then reply.');
    assert.equal(reply, 'PONG');
    assertOnlyAgentEndpoint(requests);
    assert.ok(requests.length >= 3, `parent, subagent and the parent's answer (saw ${requests.length})`);
  });
});
