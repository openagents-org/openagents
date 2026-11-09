'use strict';

/**
 * Copilot sign-in detection. `copilot` /login records the signed-in GitHub
 * accounts in ~/.copilot/config.json, a JSONC file with a two-line `//`
 * header. The core had no reader for it, so every signed-in Copilot user
 * without a token env var read "Sign-in not confirmed".
 *
 * No real copilot, no network.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Installer, parseJsonLoose } = require('../src/installer');

const ENTRY = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'registry.json'), 'utf-8'),
).find((e) => e.name === 'copilot');

const TOKEN_VARS = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'];
const HEADER = '// User settings belong in settings.json.\n// This file is managed automatically.\n';

let home;
let saved;

function evaluate() {
  const inst = new Installer({ getEntry: () => ENTRY, getResolveRules: () => [] }, home);
  inst._homeForAgent = () => home;
  inst._expandHome = (p) => p.replace(/^~/, home);
  inst.env.getEffective = () => ({});
  inst.env.getForAgent = () => ({});
  return inst._evaluateReadiness('copilot', ENTRY, null, {});
}

function writeConfig(body) {
  fs.mkdirSync(path.join(home, '.copilot'), { recursive: true });
  fs.writeFileSync(path.join(home, '.copilot', 'config.json'), body, 'utf-8');
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-copilot-'));
  saved = Object.fromEntries(TOKEN_VARS.map((k) => [k, process.env[k]]));
  for (const k of TOKEN_VARS) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(home, { recursive: true, force: true });
});

describe('copilot readiness', () => {
  it('reads a signed-in account from config.json, comment header and all', () => {
    writeConfig(`${HEADER}{\n  "loggedInUsers": [{ "host": "https://github.com", "login": "octocat" }]\n}\n`);
    const r = evaluate();
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'cli_login');
  });

  it('does not read an empty account list as signed in', () => {
    writeConfig(`${HEADER}{ "loggedInUsers": [] }\n`);
    const r = evaluate();
    assert.equal(r.ready, false);
    // A GH_TOKEN or a gh sign-in still works without the list: unknown, not signed out.
    assert.equal(r.auth_status, 'unknown');
  });

  it('stays unknown with no config.json at all', () => {
    const r = evaluate();
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'unknown');
    assert.match(r.message, /Sign-in not confirmed/);
  });
});

describe('parseJsonLoose', () => {
  it('drops comments outside strings and keeps them inside', () => {
    const parsed = parseJsonLoose('// head\n{ "a": "x // y", /* note */ "b": "/* z */" }');
    assert.deepEqual(parsed, { a: 'x // y', b: '/* z */' });
  });

  it('handles escaped quotes inside strings', () => {
    assert.deepEqual(parseJsonLoose('{ "a": "say \\"hi\\" // not a comment" }'), { a: 'say "hi" // not a comment' });
  });

  it('still throws on something that is not JSON', () => {
    assert.throws(() => parseJsonLoose('not json'));
  });
});
