'use strict';

/**
 * Field report (daily errors dashboard, 2026-11): Codex agents on a ChatGPT
 * sign-in failed with "The 'gpt-6.1-sol' model is not supported when using
 * Codex with a ChatGPT account". With no model chosen, Codex ran its own
 * default, which the plan did not include; and the connection test ignored a
 * chosen model altogether, so an agent set to gpt-5.6-luna failed its test
 * on gpt-6.1-sol.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CodexAdapter = require('../src/adapters/codex');
const { codexPlanRefusedModel, codexAccountModels } = require('../src/cli-models');
const { probeAgentType, codexProbeArgs, CODE } = require('../src/probe');

const POSIX = process.platform !== 'win32';
const REFUSAL = (m) => `ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The '${m}' model is not supported when using Codex with a ChatGPT account."}}`;

/**
 * A stand-in Codex CLI: `debug models` lists the account's models; `exec`
 * answers on a listed model (given with -m) and refuses anything else, as a
 * ChatGPT plan does. Its default is gpt-6.1-sol, which the plan lacks.
 */
function fakeCodex() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-'));
  const bin = path.join(dir, 'codex');
  fs.writeFileSync(bin, `#!${process.execPath}
const a = process.argv.slice(2);
if (a[0] === 'debug' && a[1] === 'models') {
  console.log(JSON.stringify({ models: [
    { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list', priority: 1 },
    { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list', priority: 2 },
    { slug: 'internal', visibility: 'hide', priority: 0 },
  ] }));
  process.exit(0);
}
const i = a.indexOf('-m');
const model = i >= 0 ? a[i + 1] : 'gpt-6.1-sol';
if (model === 'gpt-6-luna' || model === 'gpt-5.6-luna') { console.log('Hello!'); process.exit(0); }
console.error(${JSON.stringify(REFUSAL('MODEL'))}.replace('MODEL', model));
process.exit(1);
`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

describe('codexPlanRefusedModel', () => {
  it('reads the refused model from plain and JSON errors', () => {
    assert.equal(codexPlanRefusedModel("ERROR: The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account."), 'gpt-5.5');
    assert.equal(codexPlanRefusedModel(REFUSAL('gpt-6.1-sol')), 'gpt-6.1-sol');
    assert.equal(codexPlanRefusedModel('401 Unauthorized'), null);
  });
});

describe('codexProbeArgs and the chosen model', () => {
  it('passes the chosen model with -m', () => {
    const args = codexProbeArgs(['exec', '--skip-git-repo-check', 'hi'], { CODEX_HOME: os.tmpdir() }, 'gpt-5.6-luna');
    assert.equal(args[args.indexOf('-m') + 1], 'gpt-5.6-luna');
    assert.equal(args[args.length - 1], 'hi');
  });

  it('leaves out a model that would need quoting', () => {
    const args = codexProbeArgs(['exec', 'hi'], { CODEX_HOME: os.tmpdir() }, 'gpt x&y');
    assert.ok(!args.includes('-m'));
  });
});

describe('codex connection test on a ChatGPT plan', { skip: !POSIX && 'uses a POSIX stand-in CLI' }, () => {
  const entry = { name: 'codex', label: 'Codex', probe: { args: ['exec', '--skip-git-repo-check', 'hi'] } };
  const connector = (bin) => ({
    registry: { getEntry: (t) => (t === 'codex' ? entry : null) },
    healthCheck: () => ({ installed: true, ready: true, binary: bin }),
    getAgentEnv: () => ({}),
    resolveAgentEnv: () => ({}),
  });

  it('lists the account models the stand-in offers', async () => {
    const models = await codexAccountModels(fakeCodex(), process.env);
    assert.deepEqual(models.map((m) => m.id), ['gpt-6-luna', 'gpt-5.6-luna']);
  });

  it('tests the chosen model, not Codex\'s default', async () => {
    const r = await probeAgentType(connector(fakeCodex()), 'codex', { agentEnv: { CODEX_MODEL: 'gpt-5.6-luna' }, timeoutMs: 20000 });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.message, 'Responded');
  });

  it('with no model chosen, falls back to the first model the account lists', async () => {
    const r = await probeAgentType(connector(fakeCodex()), 'codex', { timeoutMs: 20000 });
    assert.equal(r.ok, true, r.message);
    assert.match(r.message, /on gpt-6-luna: Codex's default model \(gpt-6\.1-sol\) isn't included/);
  });

  it('names the models the account lists when the chosen one is refused', async () => {
    const r = await probeAgentType(connector(fakeCodex()), 'codex', { agentEnv: { CODEX_MODEL: 'gpt-6-sol' }, timeoutMs: 20000 });
    assert.equal(r.ok, false);
    assert.equal(r.code, CODE.BAD_MODEL);
    assert.equal(r.message, "gpt-6-sol isn't included in this ChatGPT plan. Models this account lists: gpt-6-luna, gpt-5.6-luna.");
  });
});

describe('Codex chat on a ChatGPT plan', { skip: !POSIX && 'uses a POSIX stand-in CLI' }, () => {
  function fakeAdapter({ chosen = '', bin }) {
    const sent = [];
    const spawned = [];
    const fake = Object.assign(Object.create(CodexAdapter.prototype), {
      agentEnv: { ...process.env },
      workspaceModel: null,
      _directModel: chosen,
      _directApiKey: '',
      _directBaseUrl: '',
      _codexBin: bin,
      _channelThreads: {},
      workingDir: '',
      _buildSystemContext: () => 'system context',
      _log: () => {},
      _saveSessions: () => {},
      _spawnCodex: async (cmd) => {
        const i = cmd.indexOf('-m');
        const model = i >= 0 ? cmd[i + 1] : 'gpt-6.1-sol';
        spawned.push(model);
        return model === 'gpt-6-luna'
          ? { responseText: 'Hello!', exitCode: 0 }
          : { responseText: '', exitCode: 1, stderr: REFUSAL(model), turnStarted: false };
      },
      sendResponse: async (channel, content) => { sent.push({ kind: 'response', content }); },
      sendStatus: async (channel, content) => { sent.push({ kind: 'status', content }); },
      sendError: async (channel, content) => { sent.push({ kind: 'error', content }); },
    });
    return { fake, sent, spawned };
  }

  it('reruns on the first model the account lists, and keeps it', async () => {
    const { fake, sent, spawned } = fakeAdapter({ bin: fakeCodex() });
    await fake._handleViaSubprocess('hi', 'general');
    assert.deepEqual(spawned, ['gpt-6.1-sol', 'gpt-6-luna']);
    assert.deepEqual(sent.map((m) => m.kind), ['status', 'response']);
    assert.match(sent[0].content, /default model \(gpt-6\.1-sol\) isn't included in this ChatGPT plan, so this agent now runs gpt-6-luna/);
    // The next message goes straight to the fallback.
    await fake._handleViaSubprocess('again', 'general');
    assert.deepEqual(spawned, ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-luna']);
  });

  it('does not swap a model the user chose', async () => {
    const { fake, sent, spawned } = fakeAdapter({ chosen: 'gpt-6-sol', bin: fakeCodex() });
    await fake._handleViaSubprocess('hi', 'general');
    assert.deepEqual(spawned, ['gpt-6-sol']);
    assert.deepEqual(sent.map((m) => m.kind), ['error']);
  });
});
