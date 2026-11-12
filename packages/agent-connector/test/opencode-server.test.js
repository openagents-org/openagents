'use strict';

/**
 * The warm `opencode serve` (src/adapters/opencode-server.js): started on
 * demand behind a password, reused for the same setup, never shared across
 * setups while busy, stopped when idle, its live events fanned out, and turned
 * off for a while after repeated start failures. A small node script stands
 * in for the opencode binary.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { OpenCodeServer } = require('../src/adapters/opencode-server');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-server-test-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// `fake serve --port N`: requires the password, streams one event on /event,
// echoes requests, and records abort calls in ABORT_LOG.
const fake = path.join(dir, 'opencode');
fs.writeFileSync(fake, `#!/usr/bin/env node
const http = require('http'); const fs = require('fs');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const auth = 'Basic ' + Buffer.from('opencode:' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
http.createServer((req, res) => {
  if (req.headers.authorization !== auth) { res.statusCode = 401; return res.end('no'); }
  if (req.url === '/event') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"type":"server.connected","properties":{}}\\n\\n');
    return;
  }
  if (req.method === 'POST' && /\\/session\\/[^/]+\\/abort$/.test(req.url)) fs.appendFileSync(process.env.ABORT_LOG, req.url + '\\n');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ path: req.url }));
}).listen(port, '127.0.0.1');
`);
fs.chmodSync(fake, 0o755);
const broken = path.join(dir, 'broken-opencode');
fs.writeFileSync(broken, '#!/bin/sh\nexit 1\n');
fs.chmodSync(broken, 0o755);

const abortLog = path.join(dir, 'aborts.log');
const env = (extra = {}) => ({ ...process.env, ABORT_LOG: abortLog, ...extra });

describe('OpenCode server', { skip: process.platform === 'win32' && 'the warm server is not used on Windows' }, () => {
  it('starts on demand behind a password, and is reused for the same setup', async () => {
    const server = new OpenCodeServer({ binary: fake });
    try {
      assert.equal(await server.acquire({ env: env(), cwd: dir }), true);
      const url = server._url;
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal((await fetch(url + '/session')).status, 401);  // no password, no access
      assert.deepEqual(await server.request('GET', '/session'), { path: '/session' });
      server.release();
      assert.equal(await server.acquire({ env: env(), cwd: dir }), true);
      assert.equal(server._url, url);
      server.release();
    } finally { server.stop(); }
  });

  it('is not shared with a different setup while busy, and restarts for it when idle', async () => {
    const server = new OpenCodeServer({ binary: fake });
    try {
      await server.acquire({ env: env({ CHANNEL: 'a' }), cwd: dir });
      const first = server._url;
      assert.equal(await server.acquire({ env: env({ CHANNEL: 'b' }), cwd: dir }), false);
      server.release();
      assert.equal(await server.acquire({ env: env({ CHANNEL: 'b' }), cwd: dir }), true);
      assert.notEqual(server._url, first);
      server.release();
    } finally { server.stop(); }
  });

  it('fans its live events out to subscribers', async () => {
    const server = new OpenCodeServer({ binary: fake });
    try {
      const seen = [];
      server.subscribe((e) => seen.push(e.type));
      await server.acquire({ env: env(), cwd: dir });
      for (let i = 0; i < 40 && !seen.length; i++) await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(seen, ['server.connected']);
      server.release();
    } finally { server.stop(); }
  });

  it('stops after being idle', async () => {
    const server = new OpenCodeServer({ binary: fake, idleMs: 200 });
    try {
      await server.acquire({ env: env(), cwd: dir });
      server.release();
      assert.ok(server.running);
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(server.running, false);
    } finally { server.stop(); }
  });

  it('asks the server to abort a session', async () => {
    const server = new OpenCodeServer({ binary: fake });
    try {
      await server.acquire({ env: env(), cwd: dir });
      assert.equal(await server.abort('ses_123'), true);
      assert.match(fs.readFileSync(abortLog, 'utf-8'), /\/session\/ses_123\/abort/);
      server.release();
    } finally { server.stop(); }
  });

  it('runs without a server when it cannot start, and stays off after repeated failures', async () => {
    const server = new OpenCodeServer({ binary: broken, startTimeoutMs: 2000 });
    assert.equal(await server.acquire({ env: env(), cwd: dir }), false);
    assert.equal(await server.acquire({ env: env(), cwd: dir }), false);
    server.binary = fake;  // would start now, but it's backed off
    assert.equal(await server.acquire({ env: env(), cwd: dir }), false);
    server.stop();
  });
});
