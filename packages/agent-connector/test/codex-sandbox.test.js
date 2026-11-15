'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CodexAdapter = require('../src/adapters/codex');
const { EnvManager } = require('../src/env');
const { Registry } = require('../src/registry');

function adapter(agentEnv, resume = false) {
  const calls = [];
  const errors = [];
  const fake = Object.assign(Object.create(CodexAdapter.prototype), {
    agentEnv, _directModel: '', _directApiKey: '', _directBaseUrl: '',
    _codexBin: 'codex', workingDir: '',
    _channelThreads: resume ? { general: 'saved-thread' } : {},
    _buildSystemContext: () => 'context', _log: () => {}, _saveSessions: () => {},
    _spawnCodex: async (cmd, env) => {
      calls.push({ cmd, env });
      return { responseText: 'ok', exitCode: 0 };
    },
    sendResponse: async () => {}, sendError: async (_, error) => errors.push(error),
  });
  return { fake, calls, errors };
}

describe('Codex execution policy', () => {
  for (const resume of [false, true]) {
    for (const mode of ['read-only', 'workspace-write', 'inherit']) {
      it(`${mode} is honored for ${resume ? 'resumed' : 'fresh'} turns`, async () => {
        const { fake, calls, errors } = adapter({ CODEX_SANDBOX_MODE: mode }, resume);
        await fake._handleViaSubprocess('hello', 'general');
        assert.deepEqual(errors, []);
        assert.equal(calls.length, 1);
        const { cmd } = calls[0];
        assert.ok(!cmd.includes('--dangerously-bypass-approvals-and-sandbox'));
        assert.equal(cmd.includes('resume'), resume);
        if (mode === 'inherit') assert.ok(!cmd.includes('--sandbox'));
        else {
          const index = cmd.indexOf('--sandbox');
          assert.ok(index > 0);
          assert.equal(cmd[index + 1], mode);
          if (resume) assert.ok(index < cmd.indexOf('resume'));
        }
      });
    }
  }

  it('preserves the legacy default only when unset or blank', async () => {
    for (const env of [{}, { CODEX_SANDBOX_MODE: '' }, { CODEX_SANDBOX_MODE: '   ' }]) {
      const { fake, calls } = adapter(env);
      await fake._handleViaSubprocess('hello', 'general');
      assert.ok(calls[0].cmd.includes('--dangerously-bypass-approvals-and-sandbox'));
    }
  });

  it('normalizes an explicitly configured mode', async () => {
    const { fake, calls } = adapter({ CODEX_SANDBOX_MODE: ' WORKSPACE-WRITE ' });
    await fake._handleViaSubprocess('hello', 'general');
    assert.ok(calls[0].cmd.includes('workspace-write'));
    assert.ok(!calls[0].cmd.includes('--dangerously-bypass-approvals-and-sandbox'));
  });

  it('rejects invalid policy before spawning without echoing its value', async () => {
    for (const mode of ['workpace-write', 'danger-full-access', 'private-invalid-value']) {
      const { fake, calls, errors } = adapter({ CODEX_SANDBOX_MODE: mode }, true);
      await fake._handleViaSubprocess('hello', 'general');
      assert.equal(calls.length, 0);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /CODEX_SANDBOX_MODE/);
      assert.ok(!errors[0].includes(mode));
      assert.equal(fake._channelThreads.general, 'saved-thread');
    }
  });

  it('uses the same resolved environment as the subprocess', async () => {
    const old = process.env.CODEX_SANDBOX_MODE;
    try {
      process.env.CODEX_SANDBOX_MODE = 'read-only';
      const { fake, calls } = adapter(undefined);
      await fake._handleViaSubprocess('hello', 'general');
      assert.ok(calls[0].cmd.includes('read-only'));
      assert.equal(calls[0].env.CODEX_SANDBOX_MODE, 'read-only');
      const own = adapter({ CODEX_SANDBOX_MODE: 'workspace-write' });
      await own.fake._handleViaSubprocess('hello', 'general');
      assert.ok(own.calls[0].cmd.includes('workspace-write'));
    } finally {
      if (old === undefined) delete process.env.CODEX_SANDBOX_MODE;
      else process.env.CODEX_SANDBOX_MODE = old;
    }
  });

  it('preserves policy through saved type settings and CLI-login agent resolution', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-policy-'));
    const manager = new EnvManager(dir);
    const registry = new Registry(dir);
    try {
      for (const value of [' read-only ', 'inherit', 'workpace-write', '   ']) {
        manager.save('codex', { CODEX_SANDBOX_MODE: value });
        const env = manager.getForAgent('codex', registry, { OPENAGENTS_AUTH_MODE: 'cli_login' });
        const { fake, calls, errors } = adapter(env);
        await fake._handleViaSubprocess('hello', 'general');
        if (value === 'workpace-write') {
          assert.equal(calls.length, 0);
          assert.equal(errors.length, 1);
        } else {
          assert.equal(errors.length, 0);
          assert.equal(calls.length, 1);
          assert.equal(calls[0].cmd.includes('--dangerously-bypass-approvals-and-sandbox'), !value.trim());
          if (value.trim() === 'read-only') assert.ok(calls[0].cmd.includes('read-only'));
        }
      }
    } finally {
      fs.unlinkSync(path.join(dir, 'env', 'codex.env'));
      fs.rmdirSync(path.join(dir, 'env'));
      fs.rmdirSync(dir);
    }
  });

  it('retains the configured sandbox when retrying a stale session fresh', async () => {
    const { fake, calls } = adapter({ CODEX_SANDBOX_MODE: 'workspace-write' }, true);
    fake._spawnCodex = async (cmd) => {
      calls.push(cmd);
      return calls.length === 1
        ? { responseText: '', exitCode: 1, stderr: 'no rollout found for thread id' }
        : { responseText: 'ok', exitCode: 0 };
    };
    await fake._handleViaSubprocess('hello', 'general');
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes('resume'));
    assert.ok(!calls[1].includes('resume'));
    for (const cmd of calls) {
      assert.ok(cmd.includes('workspace-write'));
      assert.ok(!cmd.includes('--dangerously-bypass-approvals-and-sandbox'));
    }
  });
});
