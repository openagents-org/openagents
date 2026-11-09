'use strict';

/**
 * The workspace API helper DeepSeek Harness runs use on Windows, where dsh's
 * sandbox leaves curl.exe without TLS credentials. Driven as the agent drives
 * it — `node deepseek-workspace-api.js …` with everything else in the
 * environment — against a local server standing in for the workspace.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const HELPER = path.join(__dirname, '..', 'src', 'adapters', 'deepseek-workspace-api.js');
const TOKEN = 'wst_helper_test_token';

let server;
let endpoint;
let seen = [];
let tmp;

function helper(args, { env = {}, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [HELPER, ...args], {
      env: {
        ...process.env,
        OPENAGENTS_WORKSPACE_AUTH: TOKEN,
        OPENAGENTS_WORKSPACE_ENDPOINT: endpoint,
        OPENAGENTS_WORKSPACE_ID: 'ws-1',
        OPENAGENTS_AGENT_NAME: 'dsh-agent',
        ...env,
      },
      encoding: 'utf-8',
      timeout: 10000,
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-api-'));
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      seen.push({ method: req.method, url: req.url, token: req.headers['x-workspace-token'], body });
      if (req.url.startsWith('/missing')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{"code":404}');
        return;
      }
      if (req.url.startsWith('/v1/files/f1')) {
        res.writeHead(200);
        res.end(Buffer.from([0, 1, 2, 255]));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 0, data: { id: 'ok-1' } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${server.address().port}/`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('deepseek-workspace-api helper', () => {
  it('GETs with the token from the environment and prints the response', async () => {
    seen = [];
    const r = await helper(['GET', '/v1/files?network=ws-1']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /"ok-1"/);
    assert.deepEqual([seen[0].method, seen[0].url, seen[0].token], ['GET', '/v1/files?network=ws-1', TOKEN]);
  });

  it('POSTs a JSON body from --body-file, BOM and non-ASCII intact', async () => {
    seen = [];
    const file = path.join(tmp, 'body.json');
    fs.writeFileSync(file, '﻿{"payload":{"content":"你好"}}', 'utf-8');
    const r = await helper(['POST', '/v1/events', '--body-file', file]);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(seen[0].body), { payload: { content: '你好' } });
  });

  it('POSTs a JSON body piped on stdin', async () => {
    seen = [];
    const r = await helper(['post', '/v1/events'], { input: '{"a":1}\n' });
    assert.equal(r.code, 0);
    assert.equal(seen[0].body, '{"a":1}');
  });

  it('refuses a body that is not JSON without sending anything', async () => {
    seen = [];
    const r = await helper(['POST', '/v1/events'], { input: "{a:1}" });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not valid JSON/);
    assert.equal(seen.length, 0);
  });

  it('uploads a file to the named channel as this agent', async () => {
    seen = [];
    const file = path.join(tmp, 'notes.md');
    fs.writeFileSync(file, '# hi\n');
    const r = await helper(['upload', file, '--channel', 'thread-7']);
    assert.equal(r.code, 0);
    const body = JSON.parse(seen[0].body);
    assert.equal(seen[0].url, '/v1/files/base64');
    assert.deepEqual(
      [body.filename, body.content_type, body.network, body.channel_name, body.source],
      ['notes.md', 'text/markdown', 'ws-1', 'thread-7', 'openagents:dsh-agent'],
    );
    assert.equal(Buffer.from(body.content_base64, 'base64').toString(), '# hi\n');
  });

  it('downloads binary content to a file', async () => {
    const out = path.join(tmp, 'out.bin');
    const r = await helper(['download', 'f1', out]);
    assert.equal(r.code, 0);
    assert.deepEqual([...fs.readFileSync(out)], [0, 1, 2, 255]);
  });

  it('exits 1 on an HTTP error, still printing the body', async () => {
    const r = await helper(['GET', '/missing']);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /404/);
    assert.match(r.stderr, /HTTP 404/);
  });

  it('exits 2 when the token is missing, and never sends', async () => {
    seen = [];
    const r = await helper(['GET', '/v1/files'], { env: { OPENAGENTS_WORKSPACE_AUTH: '' } });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /OPENAGENTS_WORKSPACE_AUTH is not set/);
    assert.equal(seen.length, 0);
  });
});
