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
        if (model === 'thinking-model') {
          // What OpenAI answers when a reasoning model spends the whole
          // token budget thinking.
          res.statusCode = 400;
          res.end(JSON.stringify({ error: {
            message: 'Could not finish the message because max_tokens or model output limit was reached. Please try again with higher max_tokens.',
            type: 'invalid_request_error',
          } }));
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

  // Field report 2026-10-29: a working agent on a reasoning model failed its
  // smoke test with this 400. The key and the model were both accepted.
  it('passes a model that ran out of the small token budget while thinking', async () => {
    const res = await testLLMConnection(env(), { model: 'thinking-model' });
    assert.equal(res.success, true);
    assert.equal(res.model, 'thinking-model');
  });
});

// A relay that drops the first connection and answers the next one.
describe('testLLMConnection — a dropped connection', () => {
  let server;
  let base;
  let hits = 0;

  before(async () => {
    server = http.createServer((req, res) => {
      hits++;
      if (hits === 1) { req.socket.destroy(); return; }
      req.resume();
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ model: 'm', choices: [{ message: { content: 'Hello there, nice to meet' } }] }));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}/v1`;
  });
  after(() => new Promise((r) => server.close(r)));

  it('is tried once more before the test fails', async () => {
    const res = await testLLMConnection({ OPENAI_API_KEY: 'sk-test-123456', OPENAI_BASE_URL: base }, { model: 'm' });
    assert.equal(res.success, true, res.error);
    assert.equal(hits, 2);
  });
});

describe('testLLMConnection — every address of the host refused', () => {
  it('says why instead of failing on the missing body', async () => {
    // localhost resolves to ::1 and 127.0.0.1; Node 20+ tries both and raises
    // an AggregateError whose own message is empty.
    const r = await testLLMConnection({ OPENAI_API_KEY: 'x', OPENAI_BASE_URL: 'http://localhost:1/v1' }, { model: 'm' });
    assert.equal(r.success, false);
    assert.match(r.error, /ECONNREFUSED/);
    assert.doesNotMatch(r.error, /reading 'slice'/);
  });
});

describe('networkErrorText', () => {
  const { networkErrorText } = require('../src/adapters/utils');
  it('reads the reasons of an AggregateError whose message is empty', () => {
    const e = new AggregateError([new Error('connect ECONNREFUSED ::1:443'), new Error('connect ECONNREFUSED 127.0.0.1:443')], '');
    assert.equal(networkErrorText(e), 'connect ECONNREFUSED ::1:443; connect ECONNREFUSED 127.0.0.1:443');
  });
  it('falls back to the code, then a fixed text', () => {
    assert.equal(networkErrorText(Object.assign(new Error(''), { code: 'ETIMEDOUT' })), 'ETIMEDOUT');
    assert.equal(networkErrorText(null), 'unknown network error');
  });
});

// Codex in Responses mode sends client_metadata on every turn. A relay that
// refuses it passed the chat/completions test and failed every run.
describe('testLLMConnection — the Responses API, asked the way Codex asks it', () => {
  let server;
  let root;
  const seen = [];
  // What the relay does: 'stream' (only streams, like the Codex CLI expects),
  // 'refuse' (client_metadata), 'refuse-cap' (max_output_tokens only),
  // 'fail-in-stream' (200, then an error event), 'json' (ignores stream),
  // 'created-only' (response.created, then the stream ends),
  // 'refuse-cap-in-stream' / 'refuse-in-stream' (200, then an error event
  // whose long message comes before its param).
  let mode = 'stream';
  const LONG = 'The upstream provider rejected this request. '.repeat(8);

  const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

  before(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        seen.push({ url: req.url, body: parsed, accept: req.headers.accept });
        // Only one path answers, as on a relay mounted under /codex.
        if (req.url !== '/codex/responses') {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: { message: `No route for ${req.url}` } }));
          return;
        }
        const refusal = (param) => {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: { message: `Unsupported parameter: ${param}`, type: 'invalid_request_error', param, code: 'unsupported_parameter' } }));
        };
        if (mode === 'refuse' && parsed.client_metadata) return refusal('client_metadata');
        if (mode === 'refuse-cap' && 'max_output_tokens' in parsed) return refusal('max_output_tokens');
        if (mode === 'json') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ model: parsed.model, max_output_tokens: parsed.max_output_tokens ?? null, output: [] }));
          return;
        }
        if (parsed.stream !== true) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: 'Only stream: true is supported' } }));
          return;
        }
        res.setHeader('content-type', 'text/event-stream');
        // The created event echoes the request, max_output_tokens included.
        const response = { id: 'resp_1', model: parsed.model, max_output_tokens: parsed.max_output_tokens ?? null };
        const refusedInStream = (param) => res.end(sse([
          { type: 'response.created', response },
          { type: 'error', code: 'unsupported_parameter', message: `${LONG}Unsupported parameter: ${param}`, param },
        ]));
        if (mode === 'refuse-cap-in-stream' && 'max_output_tokens' in parsed) return refusedInStream('max_output_tokens');
        if (mode === 'refuse-in-stream') return refusedInStream('client_metadata');
        if (mode === 'created-only') {
          res.end(sse([{ type: 'response.created', response }]));
          return;
        }
        if (mode === 'fail-in-stream') {
          res.end(sse([
            { type: 'response.created', response },
            { type: 'response.failed', response: { ...response, error: { code: 'server_error', message: 'upstream exploded' } } },
          ]));
          return;
        }
        res.end(sse([
          { type: 'response.created', response },
          { type: 'response.output_text.delta', delta: 'Hi there, ' },
          { type: 'response.output_text.delta', delta: 'how are you' },
          { type: 'response.completed', response },
        ]));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    root = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => server.close(r)));

  const env = () => ({ OPENAI_API_KEY: 'sk-test-123456', OPENAI_BASE_URL: `${root}/codex` });
  const test = () => testLLMConnection(env(), { model: 'gpt-5.5', protocol: 'responses' });

  it('streams to <base>/responses with the fields Codex sends, and reads the reply', async () => {
    mode = 'stream';
    const res = await test();
    assert.equal(res.success, true, JSON.stringify(res));
    assert.equal(res.response, 'Hi there, how are you');
    const last = seen.at(-1);
    assert.equal(last.url, '/codex/responses', 'the configured path as Codex calls it — no /v1 added');
    assert.equal(last.body.stream, true);
    assert.equal(last.accept, 'text/event-stream');
    assert.equal(last.body.model, 'gpt-5.5');
    assert.equal(typeof last.body.client_metadata.session_id, 'string');
    assert.equal(last.body.store, false);
    assert.equal(last.body.messages, undefined);
  });

  it('keeps a /v1 that is configured, and a trailing slash does not change the path', async () => {
    mode = 'stream';
    await testLLMConnection({ ...env(), OPENAI_BASE_URL: `${root}/codex/` }, { model: 'gpt-5.5', protocol: 'responses' });
    assert.equal(seen.at(-1).url, '/codex/responses');
    await testLLMConnection({ ...env(), OPENAI_BASE_URL: `${root}/v1` }, { model: 'gpt-5.5', protocol: 'responses' });
    assert.equal(seen.at(-1).url, '/v1/responses');
  });

  it('fails, with the endpoint\'s own words, where the endpoint refuses one', async () => {
    mode = 'refuse';
    const res = await test();
    assert.equal(res.success, false);
    assert.match(res.error, /^HTTP 400: .*Unsupported parameter: client_metadata.*"param":"client_metadata"/);
  });

  it('asks again without max_output_tokens — its own field, not one Codex sends — when that is refused', async () => {
    mode = 'refuse-cap';
    const before = seen.length;
    const res = await test();
    assert.equal(res.success, true, JSON.stringify(res));
    const sent = seen.slice(before);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].body.max_output_tokens, 16);
    assert.equal('max_output_tokens' in sent[1].body, false);
    assert.equal(typeof sent[1].body.client_metadata.session_id, 'string', 'the CLI\'s own fields stay');
  });

  it('does not ask again because a stream echoed max_output_tokens back', async () => {
    mode = 'fail-in-stream';
    const before = seen.length;
    const res = await test();
    assert.equal(res.success, false);
    assert.match(res.error, /response\.failed: .*upstream exploded/);
    assert.equal(seen.length - before, 1);
  });

  it('fails where a JSON body comes back in place of the stream the CLI reads — once, though it echoes max_output_tokens', async () => {
    mode = 'json';
    const before = seen.length;
    const res = await test();
    assert.equal(res.success, false);
    assert.match(res.error, /not the event stream the Codex CLI reads/);
    assert.equal(seen.length - before, 1);
  });

  it('does not ask again for a stream that ends after response.created echoed max_output_tokens', async () => {
    mode = 'created-only';
    const before = seen.length;
    const res = await test();
    assert.equal(res.success, false);
    assert.match(res.error, /^Stream ended before response\.completed/);
    assert.match(res.error, /max_output_tokens/, 'the echo is in what is shown');
    assert.equal(seen.length - before, 1);
  });

  it('asks again when an error event refuses max_output_tokens after a long message', async () => {
    mode = 'refuse-cap-in-stream';
    const before = seen.length;
    const res = await test();
    assert.equal(res.success, true, JSON.stringify(res));
    const sent = seen.slice(before);
    assert.equal(sent.length, 2);
    assert.equal('max_output_tokens' in sent[1].body, false);
  });

  it('keeps the refused field in what it shows when a long message comes first', async () => {
    mode = 'refuse-in-stream';
    const before = seen.length;
    const res = await test();
    assert.equal(res.success, false);
    assert.equal(seen.length - before, 1);
    assert.ok(LONG.length > 200);
    assert.match(res.error, /^error: \{"param":"client_metadata","code":"unsupported_parameter"/);
  });
});
