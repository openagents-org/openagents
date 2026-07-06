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

// Run the CLI capturing stdout even when the process exits non-zero, with an
// optional custom environment. `timeout` guards against any accidental hang.
function runCapture({ env, timeout = 35000 } = {}, ...args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf-8',
      timeout,
      env: env || process.env,
    });
    return { code: 0, stdout: stdout.trim() };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : 1,
      stdout: (e.stdout || '').toString().trim(),
      stderr: (e.stderr || '').toString().trim(),
    };
  }
}

// Environment with the workspace token vars stripped, for deterministic
// "missing token" assertions regardless of the host environment.
function envWithoutTokens(extra = {}) {
  const env = { ...process.env };
  delete env.OPENAGENTS_WORKSPACE_TOKEN;
  delete env.OA_WORKSPACE_TOKEN;
  return { ...env, ...extra };
}

describe('CLI', () => {
  it('help', () => {
    const out = run('help');
    assert.ok(out.includes('Usage: agn'));
    assert.ok(out.includes('up'));
    assert.ok(out.includes('down'));
    assert.ok(out.includes('restart'));
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
      assert.ok(createOut.includes('Created local agent: test-agent'));
      assert.ok(!createOut.includes('Installing claude...'));

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

  it('create rejects an unknown agent type without creating an entry', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cli-'));
    try {
      const res = runCapture({}, 'create', 'random-bot', '--type', 'calude', '--config', tmpDir);
      assert.equal(res.code, 1);
      assert.ok(res.stdout.includes("unknown agent type 'calude'"));
      assert.ok(!res.stdout.includes('Created local agent'));

      // The invalid agent must NOT be persisted to config.
      const listOut = runWithConfig(tmpDir, 'list');
      assert.ok(listOut.includes('No agents configured'));
      assert.ok(!listOut.includes('random-bot'));
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

  it('help mentions optional create install flag', () => {
    const out = run('help');
    assert.ok(out.includes('--install'));
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

  it('create prints local-only Dashboard warning when not connected', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cli-'));
    try {
      const out = runWithConfig(tmpDir, 'create', 'local-agent', '--type', 'kimi');
      assert.ok(out.includes('Created local agent: local-agent'));
      assert.ok(out.includes('local-only'));
      assert.ok(out.includes('Workspace Dashboard'));
      // Points the user at the next command, scoped to the new agent name.
      assert.ok(out.includes('agn connect local-agent'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('connect with explicit token is accepted (backward compatible)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cli-'));
    try {
      runWithConfig(tmpDir, 'create', 'conn-agent', '--type', 'kimi');
      const { stdout } = runCapture(
        { env: envWithoutTokens() },
        'connect', 'conn-agent', 'tok-explicit-123', '--config', tmpDir,
      );
      // Token accepted: it proceeds to resolution rather than the
      // missing-token error path. (Resolution itself may fail offline.)
      assert.ok(stdout.includes('Resolving workspace token'));
      assert.ok(!stdout.includes('Workspace token is required'));
      // The token value must never be printed.
      assert.ok(!stdout.includes('tok-explicit-123'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('connect reads OPENAGENTS_WORKSPACE_TOKEN from env', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cli-'));
    try {
      runWithConfig(tmpDir, 'create', 'env-agent', '--type', 'kimi');
      const { stdout } = runCapture(
        { env: envWithoutTokens({ OPENAGENTS_WORKSPACE_TOKEN: 'tok-from-env-456' }) },
        'connect', 'env-agent', '--config', tmpDir,
      );
      // Env token picked up: reaches resolution, not the missing-token error.
      assert.ok(stdout.includes('Resolving workspace token'));
      assert.ok(!stdout.includes('Workspace token is required'));
      assert.ok(!stdout.includes('tok-from-env-456'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('connect without token in non-interactive mode errors and does not hang', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cli-'));
    try {
      runWithConfig(tmpDir, 'create', 'noenv-agent', '--type', 'kimi');
      // Short timeout proves the command returns immediately (never prompts).
      const { code, stdout } = runCapture(
        { env: envWithoutTokens(), timeout: 10000 },
        'connect', 'noenv-agent', '--config', tmpDir,
      );
      assert.equal(code, 1);
      assert.ok(stdout.includes('Workspace token is required.'));
      assert.ok(stdout.includes('Workspace Dashboard'));
      assert.ok(stdout.includes('agn connect noenv-agent <workspace-token>'));
      // It must not have started resolving (no token was available).
      assert.ok(!stdout.includes('Resolving workspace token'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
