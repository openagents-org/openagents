'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { listEndpointModels, parseModels } = require('../src/model-list');

function stub(status, body) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { calls, fetchImpl };
}

describe('listEndpointModels', () => {
  it('adds /v1 to a bare host', async () => {
    const { calls, fetchImpl } = stub(200, { data: [{ id: 'm1' }] });
    await listEndpointModels({ baseUrl: 'https://relay.example.com', apiKey: 'k', fetchImpl });
    assert.equal(calls[0].url, 'https://relay.example.com/v1/models');
  });

  it('keeps a path that is not /v1', async () => {
    const { calls, fetchImpl } = stub(200, { data: [{ id: 'm1' }] });
    await listEndpointModels({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', apiKey: 'k', fetchImpl });
    assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/models');
  });

  it('reads a URL written without a scheme and drops its userinfo', async () => {
    const { calls, fetchImpl } = stub(200, { data: [{ id: 'm1' }] });
    await listEndpointModels({ baseUrl: 'localhost:4000', apiKey: 'k', fetchImpl });
    assert.equal(calls[0].url, 'http://localhost:4000/v1/models');
    const second = stub(200, { data: [{ id: 'm1' }] });
    await listEndpointModels({ baseUrl: 'https://u:p@relay.example.com/v1', apiKey: 'k', fetchImpl: second.fetchImpl });
    assert.equal(second.calls[0].url, 'https://relay.example.com/v1/models');
  });

  it('uses x-api-key only on the official Anthropic API', async () => {
    const { calls, fetchImpl } = stub(200, { data: [{ id: 'claude-opus-5' }] });
    await listEndpointModels({ baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k', protocol: 'anthropic', fetchImpl });
    assert.equal(calls[0].url, 'https://api.anthropic.com/v1/models?limit=100');
    assert.equal(calls[0].headers['x-api-key'], 'k');
    assert.equal(calls[0].headers.Authorization, undefined);
  });

  it('says why when there is no key, the list is empty, or the host is down', async () => {
    const none = await listEndpointModels({ baseUrl: 'https://relay.example.com', apiKey: '', fetchImpl: stub(200, {}).fetchImpl });
    assert.match(none.error, /No API key/);
    const empty = await listEndpointModels({ baseUrl: 'https://relay.example.com', apiKey: 'k', fetchImpl: stub(200, '<html>').fetchImpl });
    assert.equal(empty.error, 'The endpoint listed no models.');
    const down = await listEndpointModels({
      baseUrl: 'https://relay.example.com',
      apiKey: 'k',
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    assert.equal(down.error, 'Could not reach relay.example.com: ECONNREFUSED');
  });
});

describe('parseModels', () => {
  it('accepts a bare array and a relay models envelope', () => {
    assert.deepEqual(parseModels('["b","a"]').map((m) => m.id), ['a', 'b']);
    assert.deepEqual(parseModels('{"models":[{"id":"x"}]}'), [{ id: 'x', label: 'x' }]);
  });
});
