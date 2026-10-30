'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { probeAgentType } = require('../src/probe');

function connector(type, env, binary) {
  return {
    registry: { getEntry: () => ({ name: type, label: type }) },
    healthCheck: () => ({ installed: true, ready: true, binary }),
    getAgentEnv: () => env,
    resolveAgentEnv: () => ({}),
  };
}

// Keep the real probe and request builder; intercept only the external transport.
function captureRequests(t) {
  const requests = [];
  t.mock.method(https, 'request', (url, options, respond) => {
    const req = new EventEmitter();
    req.write = (body) => requests.push({ url, headers: options.headers, body: JSON.parse(body) });
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      respond(res);
      res.emit('data', JSON.stringify({
        choices: [{ message: { content: 'hi' } }], content: [{ text: 'hi' }],
      }));
      res.emit('end');
    });
    return req;
  });
  return requests;
}

// Exercise the actual model-list subprocess, including Windows' .cmd shim.
function modelCli(t, models) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-mimo probe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'models.js');
  fs.writeFileSync(script, [
    "const assert = require('node:assert/strict');",
    "assert.deepEqual(process.argv.slice(2), ['models', 'xiaomi']);",
    'assert.equal(process.env.LLM_API_KEY, undefined);',
    'assert.equal(process.env.XIAOMI_API_KEY, undefined);',
    "assert.equal(process.env.MIMOCODE_AUTH_CONTENT, '{}');",
    'const config = JSON.parse(process.env.MIMOCODE_CONFIG_CONTENT);',
    "assert.deepEqual(config.enabled_providers, ['xiaomi']);",
    'process.stdout.write(' + JSON.stringify(models) + ');',
  ].join('\n'));
  const binary = path.join(dir, process.platform === 'win32' ? 'mimo.cmd' : 'mimo');
  fs.writeFileSync(binary, process.platform === 'win32'
    ? '@"' + process.execPath + '" "' + script + '" %*\r\n'
    : '#!/bin/sh\nexec "' + process.execPath + '" "' + script + '" "$@"\n', { mode: 0o755 });
  return binary;
}

describe('MiMo health-check routing', () => {
  const cases = [
    {
      name: 'uses MiMo instead of OpenAI when only the key and model are saved',
      env: { LLM_API_KEY: 'agent-key', LLM_MODEL: 'mimo-v2.6-pro' },
      url: 'https://api.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.6-pro',
    },
    {
      name: 'preserves a Token Plan endpoint and removes the CLI provider prefix',
      env: { LLM_API_KEY: 'agent-key', LLM_BASE_URL: 'https://token-plan-cn.xiaomimimo.com/v1', LLM_MODEL: 'xiaomi/mimo-v2.6-pro' },
      url: 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.6-pro',
    },
    {
      name: 'preserves a custom endpoint and its vendor/model identifier',
      env: { LLM_API_KEY: 'agent-key', LLM_BASE_URL: 'https://relay.example/v1', LLM_MODEL: 'vendor/model' },
      url: 'https://relay.example/v1/chat/completions', model: 'vendor/model',
    },
    {
      name: 'uses the MiMo agent key rather than unrelated provider credentials',
      env: { LLM_API_KEY: 'agent-key', LLM_MODEL: 'mimo-v2.6-pro', KIMI_API_KEY: 'other-key', KIMI_MODEL: 'other-model' },
      url: 'https://api.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.6-pro',
    },
  ];
  for (const example of cases) {
    it(example.name, async (t) => {
      const requests = captureRequests(t);
      const result = await probeAgentType(connector('mimo-code', example.env), 'mimo-code');
      assert.equal(result.ok, true);
      assert.equal(result.method, 'llm_api');
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, example.url);
      assert.equal(requests[0].body.model, example.model);
      assert.equal(requests[0].headers.Authorization, 'Bearer agent-key');
    });
  }

  it('selects the CLI catalogue pro model when no model is configured', async (t) => {
    const requests = captureRequests(t);
    const binary = modelCli(t, 'xiaomi/mimo-next-flash window 1\nxiaomi/mimo-next-pro window 2\n');
    const result = await probeAgentType(connector('mimo-code', { LLM_API_KEY: 'agent-key' }, binary), 'mimo-code');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(requests[0].url, 'https://api.xiaomimimo.com/v1/chat/completions');
    assert.equal(requests[0].body.model, 'mimo-next-pro');
  });

  it('does not test an invented OpenAI model when the CLI lists no models', async (t) => {
    const requests = captureRequests(t);
    const binary = modelCli(t, '');
    const result = await probeAgentType(connector('mimo-code', { LLM_API_KEY: 'agent-key' }, binary), 'mimo-code');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'bad_model');
    assert.equal(requests.length, 0);
    assert.match(result.message, /model/i);
  });

  it('requires a model for a custom endpoint without sending a fallback request', async (t) => {
    const requests = captureRequests(t);
    const env = { LLM_API_KEY: 'agent-key', LLM_BASE_URL: 'https://relay.example/v1' };
    const result = await probeAgentType(connector('mimo-code', env), 'mimo-code');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'bad_model');
    assert.equal(requests.length, 0);
  });

  it('keeps a signed-in agent on static checks instead of using the type saved key', async (t) => {
    const requests = captureRequests(t);
    const result = await probeAgentType(connector('mimo-code', { LLM_API_KEY: 'type-key' }), 'mimo-code', {
      agentEnv: { OPENAGENTS_AUTH_MODE: 'cli_login', LLM_MODEL: 'mimo-v2.6-pro' },
    });
    assert.equal(result.ok, true);
    assert.equal(result.code, 'static_only');
    assert.equal(requests.length, 0);
  });
});

describe('other agents retain their health-check routing', () => {
  for (const example of [
    { type: 'openclaw', env: { LLM_API_KEY: 'agent-key' }, url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
    { type: 'kimi', env: { KIMI_API_KEY: 'agent-key' }, url: 'https://api.moonshot.ai/v1/chat/completions', model: 'kimi-k2.6' },
    { type: 'claude', env: { ANTHROPIC_API_KEY: 'agent-key' }, url: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-20250514' },
  ]) {
    it(example.type, async (t) => {
      const requests = captureRequests(t);
      const result = await probeAgentType(connector(example.type, example.env), example.type);
      assert.equal(result.ok, true);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, example.url);
      assert.equal(requests[0].body.model, example.model);
    });
  }
});
