'use strict';

/**
 * Cursor readiness. `cursor-agent login` signs in without any API key, and the
 * registry used to recognise only CURSOR_API_KEY — so a signed-in user read
 * "installed but not signed in" in the workspace, and the re-check refused to
 * even try a run. The signed-in account is recorded under `authInfo` in
 * ~/.cursor/cli-config.json; without it the state is unknown (a live run
 * decides), never a definitive "no credentials".
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Installer } = require('../src/installer');
const registry = require('../registry.json');

const mockRegistry = { getEntry: () => null, getResolveRules: () => [] };
const cursor = registry.find((a) => a.name === 'cursor');

let tmpDir;
let savedKey;

function evaluate(configPath) {
  const entry = { ...cursor, check_ready: { ...cursor.check_ready, creds_file: configPath } };
  const inst = new Installer(mockRegistry, tmpDir);
  inst.env.getEffective = () => ({});
  return inst._evaluateReadiness('cursor', entry, '/fake/cursor-agent');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cursor-'));
  savedKey = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = savedKey;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Cursor readiness', () => {
  it('reads the CLI config that `cursor-agent login` writes', () => {
    assert.equal(cursor.check_ready.creds_file, '~/.cursor/cli-config.json');
    assert.equal(cursor.check_ready.creds_key, 'authInfo');
  });

  it('signed in with cursor-agent login (no API key) → Ready', () => {
    const p = path.join(tmpDir, 'cli-config.json');
    fs.writeFileSync(p, JSON.stringify({ version: 1, authInfo: { email: 'ada@example.com' } }));
    const r = evaluate(p);
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'cli_login');
  });

  it('config without authInfo → unknown, so a re-check still tries a run', () => {
    const p = path.join(tmpDir, 'cli-config.json');
    fs.writeFileSync(p, JSON.stringify({ version: 1 }));
    const r = evaluate(p);
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'unknown');
  });

  it('no config at all → unknown, not a definitive "no credentials"', () => {
    const r = evaluate(path.join(tmpDir, 'missing.json'));
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'unknown');
  });
});
