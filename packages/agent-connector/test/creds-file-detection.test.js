'use strict';

/**
 * The shapes a registry entry's `creds_file` can take, at the level the state
 * machine sees them. Three exist in the catalog today and each used to be read
 * wrong somewhere:
 *
 *   • a DIRECTORY of session files (Claude's ~/.claude/sessions) — an empty one
 *     is a fresh install, not a sign-in;
 *   • a JSON file with a named field (`creds_key`) — Gemini's
 *     google_accounts.json exists from install onward and records a signed-OUT
 *     account as `active: null`, so existence alone says nothing;
 *   • a file that is not JSON at all (Hermes' config.yaml) — parsing it can
 *     only ever throw, so the check has to be existence-based.
 *
 * All three are content-free at the level that matters: a value is tested for
 * emptiness, never read out, logged or returned.
 *
 * Run: node --test test/creds-file-detection.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Installer } = require('../src/installer');

const mockRegistry = { getEntry: () => null, getResolveRules: () => [] };

let tmpDir;
let inst;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-creds-'));
  inst = new Installer(mockRegistry, tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('creds_file — a directory of sessions', () => {
  it('counts when it holds anything', () => {
    const dir = path.join(tmpDir, 'sessions');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'a.json'), '{}');
    assert.equal(inst._credsFileState({ creds_file: dir }), 'present');
  });

  it('is absent while empty — a fresh install is not a sign-in', () => {
    const dir = path.join(tmpDir, 'sessions');
    fs.mkdirSync(dir);
    assert.equal(inst._credsFileState({ creds_file: dir }), 'absent');
  });
});

describe('creds_file — a JSON file with a named field', () => {
  const write = (body) => {
    const p = path.join(tmpDir, 'google_accounts.json');
    fs.writeFileSync(p, body);
    return p;
  };

  it('present when the field carries a value', () => {
    const p = write('{"active":"ada@example.com","old":[]}');
    assert.equal(inst._credsFileState({ creds_file: p, creds_key: 'active' }), 'present');
  });

  it('absent when the field is null — that is how a sign-out is recorded', () => {
    const p = write('{"active":null,"old":["ada@example.com"]}');
    assert.equal(inst._credsFileState({ creds_file: p, creds_key: 'active' }), 'absent');
  });

  it('absent when the field is an empty string', () => {
    const p = write('{"active":"   ","old":[]}');
    assert.equal(inst._credsFileState({ creds_file: p, creds_key: 'active' }), 'absent');
  });

  it('absent when the field is missing entirely', () => {
    const p = write('{"old":[]}');
    assert.equal(inst._credsFileState({ creds_file: p, creds_key: 'active' }), 'absent');
  });

  it('unreadable — not absent — when the file will not parse', () => {
    // The distinction the UI depends on: "we cannot tell" gets its own message
    // instead of asserting the user is signed out.
    const p = write('{ half a file');
    assert.equal(inst._credsFileState({ creds_file: p, creds_key: 'active' }), 'unreadable');
  });

  it('ignores the field when the entry declares none (existing agents unchanged)', () => {
    const p = write('{"active":null}');
    assert.equal(inst._credsFileState({ creds_file: p }), 'present');
  });
});

describe('creds_file — a file that is not JSON', () => {
  it('counts on existence, which is all a YAML config can offer', () => {
    const p = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(p, 'provider: openai\n');
    assert.equal(inst._credsFileState({ creds_file: p }), 'present');
  });

  it('is absent while empty', () => {
    const p = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(p, '');
    assert.equal(inst._credsFileState({ creds_file: p }), 'absent');
  });
});

describe('registry entries that depend on the above', () => {
  const registry = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'registry.json'), 'utf-8'),
  );
  const entry = (name) => (registry.agents || registry).find((a) => a.name === name);

  it('hermes opts into the existence-based check', () => {
    // Without this its config.yaml reaches JSON.parse in _checkCredsReady,
    // throws, and the whole creds_file declaration is dead weight.
    const hermes = entry('hermes').check_ready;
    assert.equal(hermes.creds_file, '~/.hermes/config.yaml');
    assert.equal(hermes.creds_no_parse, true);
  });

  it('gemini names the field that separates signed in from signed out', () => {
    const gemini = entry('gemini').check_ready;
    assert.equal(gemini.creds_file, '~/.gemini/google_accounts.json');
    assert.equal(gemini.creds_key, 'active');
  });
});
