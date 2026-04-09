'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CLI = path.join(__dirname, '..', 'bin', 'agent-connector.js');

function run(...args) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
}

function runWithConfig(tmpDir, ...args) {
  return execFileSync(process.execPath, [CLI, ...args, '--config', tmpDir], {
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
}

describe('CLI', () => {
  it('help', () => {
    const out = run('help');
    assert.ok(out.includes('Usage: agn'));
    assert.ok(out.includes('up'));
    assert.ok(out.includes('down'));
    assert.ok(out.includes('search'));
  });

  it('--help flag', () => {
    const out = run('--help');
    assert.ok(out.includes('Usage: agn'));
  });

  it('version', () => {
    const out = run('version');
    assert.ok(out.includes('@openagents-org/agent-launcher'));
    const pkg = require('../package.json');
    assert.ok(out.includes(pkg.version));
  });

  it('search returns catalog entries', () => {
    const out = run('search');
    assert.ok(out.includes('openclaw'));
    assert.ok(out.includes('claude'));
  });

  it('search with filter', () => {
    const out = run('search', 'anthropic');
    assert.ok(out.includes('claude'));
    assert.ok(!out.includes('openclaw'));
  });

  it('unknown command exits with error', () => {
    try {
      run('nonexistent-command');
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e.stderr.includes('Unknown command') || e.stdout.includes('Unknown command'));
    }
  });

  it('create / list / remove agent with temp config', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cli-'));
    try {
      const createOut = runWithConfig(tmpDir, 'create', 'test-agent', '--type', 'claude');
      assert.ok(createOut.includes("'test-agent' created"));

      const listOut = runWithConfig(tmpDir, 'list');
      assert.ok(listOut.includes('test-agent'));
      assert.ok(listOut.includes('claude'));

      const removeOut = runWithConfig(tmpDir, 'remove', 'test-agent');
      assert.ok(removeOut.includes("'test-agent' removed"));

      const emptyList = runWithConfig(tmpDir, 'list');
      assert.ok(emptyList.includes('No agents configured'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('env set and get', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cli-'));
    try {
      runWithConfig(tmpDir, 'env', 'openclaw', '--set', 'LLM_API_KEY=sk-test');
      const out = runWithConfig(tmpDir, 'env', 'openclaw');
      assert.ok(out.includes('LLM_API_KEY'));
      assert.ok(out.includes('***')); // password field masked
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('status with temp config shows no daemon', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cli-'));
    try {
      const out = runWithConfig(tmpDir, 'status');
      assert.ok(out.includes('not running'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('workspace list with temp config shows none', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cli-'));
    try {
      const out = runWithConfig(tmpDir, 'workspace', 'list');
      assert.ok(out.includes('No workspaces configured'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runtimes lists installed agents', () => {
    const out = run('runtimes');
    // At least one runtime should be installed on this machine
    assert.ok(out.includes('NAME') || out.includes('No agent runtimes'));
  });

  it('logs with temp config returns empty', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cli-'));
    try {
      const out = runWithConfig(tmpDir, 'logs');
      // Should not error — empty is fine
      assert.ok(typeof out === 'string');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
