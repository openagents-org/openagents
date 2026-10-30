'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { testLLMConnection } = require('../src/utils');

// A gateway that serves two models and refuses the rest the way the
// OpenAgents gateway does.
describe('testLLMConnection', () => {
  const SERVED = ['deepseek-3.2', 'openai-gpt-oss-20b'];
  let server;
  let base;
  const sent = [];
  const paths = [];

  before(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const model = JSON.parse(body || '{}').model;
        sent.push(model);
        paths.push(req.url);
        res.setHeader('content-type', 'application/json');
        if (req.url.endsWith('/messages')) {
          res.end(JSON.stringify({ model, content: [{ type: 'text', text: 'Hello there, nice to meet' }] }));
          return;
        }
        if (!SERVED.includes(model)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ detail: `Model '${model}' is not available. This gateway only allows: ${SERVED.join(', ')}` }));
          return;
        }
        res.end(JSON.stringify({ model, choices: [{ message: { content: 'Hello there, nice to meet' } }] }));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}/v1`;
  });
  after(() => new Promise((r) => server.close(r)));

  const env = () => ({ OPENAI_API_KEY: 'sk-test-123456', OPENAI_BASE_URL: base });

  it('sends the model the caller says the agent runs on', async () => {
    const res = await testLLMConnection({ ...env(), CODEX_MODEL: 'openai-gpt-oss-20b' }, { model: 'openai-gpt-oss-20b' });
    assert.equal(res.success, true);
    assert.equal(sent.at(-1), 'openai-gpt-oss-20b');
  });

  it('calls the endpoint the caller names over the generic ones', async () => {
    const res = await testLLMConnection(
      { LLM_API_KEY: 'sk-test-123456', LLM_BASE_URL: 'https://wrong.invalid/v1' },
      { model: 'deepseek-3.2', baseUrl: base },
    );
    assert.equal(res.success, true);
    assert.equal(sent.at(-1), 'deepseek-3.2');
  });

  it('speaks the Anthropic API to the endpoint the caller names', async () => {
    const res = await testLLMConnection(
      { ANTHROPIC_API_KEY: 'sk-ant-123456', ANTHROPIC_BASE_URL: 'https://wrong.invalid' },
      { model: 'claude-x', baseUrl: base.replace(/\/v1$/, '') },
    );
    assert.equal(res.success, true);
    assert.equal(paths.at(-1), '/v1/messages');
  });

  it('speaks the protocol the caller names, wherever the endpoint points', async () => {
    const res = await testLLMConnection(
      { LLM_API_KEY: 'sk-relay-123456', LLM_BASE_URL: base },
      { model: 'claude-x', protocol: 'anthropic' },
    );
    assert.equal(res.success, true);
    assert.equal(paths.at(-1), '/v1/messages');
  });

  it('reports a configured model the endpoint refuses as it is, without trying another', async () => {
    const before = sent.length;
    const res = await testLLMConnection(env(), { model: 'retired-model' });
    assert.equal(res.success, false);
    assert.match(res.error, /Model 'retired-model' is not available/);
    assert.deepEqual(sent.slice(before), ['retired-model']);
  });
});
