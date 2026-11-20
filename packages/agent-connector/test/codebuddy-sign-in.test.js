'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { codeBuddyLoginEnv, checkCodeBuddySignIn } = require('../src/codebuddy-sign-in');
const { Registry } = require('../src/registry');

let dir, cli;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy account '));
  cli = path.join(dir, 'fixture.cjs');
  fs.writeFileSync(cli, `
    if (process.argv[2] === '--version') { console.log('2.184.0'); process.exit(0); }
    if (!process.argv[2]) process.exit(0); // interactive login closed
    if (process.argv[2] !== '--acp') process.exit(2);
    const lines = require('node:readline').createInterface({ input: process.stdin });
    lines.on('line', line => {
      const { id, method } = JSON.parse(line);
      let result;
      if (method === 'initialize') result = { protocolVersion: 1 };
      else if (method === '_codebuddy.ai/getUserInfo') {
        if (process.env.REPLY === 'exit') process.exit(0);
        if (process.env.REPLY === 'timeout') return;
        if (process.env.REPLY === 'unsupported') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unavailable' } }));
          return;
        }
        result = JSON.parse(process.env.REPLY);
      } else process.exit(3);
      console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
    });
  `);
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

for (const [scenario, reply, expected] of [
  ['signed in', '{"userInfo":{"userId":"fixture","accessToken":"never-return-this"}}', true],
  ['signed out', '{}', false],
  ['malformed account', '{"userInfo":{}}', null],
  ['unexpected response', '{"differentSchema":true}', null],
  ['unsupported method', 'unsupported', null],
  ['premature exit', 'exit', null],
  ['timeout', 'timeout', null],
]) {
  test(scenario, async () => {
    const result = await checkCodeBuddySignIn(cli, { ...process.env, REPLY: reply }, {
      timeoutMs: reply === 'timeout' ? 250 : 4_000,
    });
    assert.equal(result, expected);
  });
}

test('uses the selected site and strips keys and relay endpoints for account detection', () => {
  const connector = {
    registry: new Registry(dir),
    getAgentEnv: () => ({ CODEBUDDY_REGION: 'international', CODEBUDDY_API_KEY: 'type-key', LLM_BASE_URL: 'https://example.invalid' }),
  };
  const env = codeBuddyLoginEnv(connector, { CODEBUDDY_REGION: 'china', CODEBUDDY_AUTH_TOKEN: 'agent-token', CODEBUDDY_BASE_URL: 'https://example.invalid', LLM_API_KEY: 'agent-key' });
  assert.equal(env.CODEBUDDY_INTERNET_ENVIRONMENT, 'internal');
  for (const key of ['CODEBUDDY_API_KEY', 'CODEBUDDY_AUTH_TOKEN', 'CODEBUDDY_BASE_URL', 'LLM_API_KEY', 'LLM_BASE_URL']) {
    assert.equal(env[key], undefined, key);
  }
});

test('runtimes and login report the same account independently of a saved key', () => {
  const pkg = path.join(dir, '.openagents', 'runtimes', 'codebuddy', 'node_modules', '@tencent-ai', 'codebuddy-code');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ bin: { codebuddy: 'fixture.cjs' } }));
  fs.copyFileSync(cli, path.join(pkg, 'fixture.cjs'));
  const run = (args, reply, key = '') => {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir, REPLY: reply, CODEBUDDY_API_KEY: key, CODEBUDDY_AUTH_TOKEN: '', LLM_API_KEY: '' };
    return spawnSync(process.execPath, [
      path.join(__dirname, '..', 'bin', 'agent-connector.js'), ...args, '--config', dir, '--no-update-check',
    ], { env, encoding: 'utf8', timeout: 20_000 });
  };
  const detect = (reply, key) => {
    const r = run(['runtimes', '--json', '--types', 'codebuddy'], reply, key);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /private-account|private-token/);
    return JSON.parse(r.stdout)[0];
  };
  const account = '{"userInfo":{"userId":"private-account","token":"private-token"}}';
  const signedIn = detect(account);
  assert.equal(signedIn.signedIn, true);
  assert.equal(signedIn.typeReady, true);
  assert.equal(signedIn.auth.mode, 'subscription');
  assert.ok(Number.isFinite(Date.parse(signedIn.signInCheckedAt)));

  const keyOnly = detect('{}', 'fixture-key');
  assert.equal(keyOnly.signedIn, false);
  assert.equal(keyOnly.auth.mode, 'api_key');
  const unknown = detect('unsupported');
  assert.equal(unknown.signedIn, null);
  assert.equal(unknown.authStatus, 'unknown');
  assert.equal(unknown.reason, null);

  const login = (reply) => run(['login', 'codebuddy'], reply);
  assert.equal(login(account).status, 0);
  assert.match(login('{}').stdout, /still not signed in/);
  assert.match(login('unsupported').stdout, /Could not confirm device sign-in/);
});
