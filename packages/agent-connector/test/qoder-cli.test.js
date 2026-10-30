'use strict';

/**
 * Optional regression against a real Qoder CLI: set QODER_TEST_CLI to a
 * `qodercli` (or `qoderclicn`, with QODER_TEST_EDITION=cn) binary. No account
 * is needed and none is used — every run here is signed out, under a
 * throwaway HOME. It does reach Qoder's service (endpoint discovery, and the
 * token exchange in the rejected-token case), so it needs network.
 *
 * What it guards is the part of the contract that holds without an account:
 *   - a user's own setup (an MCP server and a default model in
 *     ~/.qoder/settings.json) does not reach an agent run — only the workspace
 *     server is started, and the run is on the agent's model;
 *   - nothing is written into the project directory, and the shell rc files
 *     the CLI rewrites on a first start are left alone;
 *   - the failure shapes the adapter classifies (signed out, a rejected
 *     token, a resume the CLI cannot find) still look the way it expects.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  EDITIONS,
  buildQoderArgs,
  buildQoderChildEnv,
  classifyQoderRun,
  editionVar,
  interpretQoderFrame,
  parseFrame,
} = require('../src/adapters/qoder-runtime');

const cli = process.env.QODER_TEST_CLI;
const edition = process.env.QODER_TEST_EDITION === 'cn' ? EDITIONS.cn : EDITIONS.global;

// A stdio MCP server that answers the handshake and records that it ran.
const MCP_SERVER = `
const fs = require('fs');
const [name, log] = process.argv.slice(2);
fs.appendFileSync(log, name + '\\n');
let buf = '';
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
    if (m.method === 'initialize') reply({ protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name, version: '1' } });
    else if (m.method === 'tools/list') reply({ tools: [] });
    else if (m.id !== undefined) reply({});
  }
});
process.stdin.on('end', () => process.exit(0));
`;

let dir;
let home;
let project;
let mcpScript;
let mcpLog;

/** One headless run the way the adapter starts it; resolves with its frames. */
function runCli({ args, env, prompt = 'say hi' }) {
  return new Promise((resolve) => {
    const child = spawn(cli, args, { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const frames = stdout.split('\n').map(parseFrame).filter(Boolean).map(interpretQoderFrame);
      resolve({ code, signal, stderr, frames });
    });
    child.stdin.end(prompt);
  });
}

function baseEnv(extra = {}) {
  return buildQoderChildEnv({
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    SHELL: '/bin/zsh',
    ...extra,
  }, { edition, pat: extra.pat || '' });
}

function verdictOf(run) {
  const result = run.frames.find((f) => f.kind === 'result') || null;
  const apiErrors = run.frames.filter((f) => f.kind === 'assistant' && f.apiError).map((f) => f.apiError);
  return classifyQoderRun({ result, apiErrors, code: run.code, signal: run.signal, stderr: run.stderr }, edition);
}

describe('Qoder CLI (real binary)', { skip: !cli && 'set QODER_TEST_CLI to a qodercli binary' }, () => {
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-qoder-cli-'));
    home = path.join(dir, 'home');
    project = path.join(dir, 'project');
    fs.mkdirSync(project, { recursive: true });
    mcpScript = path.join(dir, 'mcp.js');
    mcpLog = path.join(dir, 'mcp.log');
    fs.writeFileSync(mcpScript, MCP_SERVER);
    // The user's own setup: an MCP server of theirs and a default model.
    const root = path.join(home, edition.configDirName);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({
      model: { name: 'lite' },
      mcpServers: { users_own: { command: process.execPath, args: [mcpScript, 'users_own', mcpLog] } },
    }));
  });

  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it("starts only the workspace MCP server and runs on the agent's model", async () => {
    const mcpConfig = path.join(dir, 'workspace-mcp.json');
    fs.writeFileSync(mcpConfig, JSON.stringify({
      mcpServers: { 'openagents-workspace': { command: process.execPath, args: [mcpScript, 'workspace', mcpLog] } },
    }));
    const run = await runCli({
      args: buildQoderArgs({ appendSystemPrompt: 'brief', model: 'performance', mcpConfigPath: mcpConfig }),
      env: baseEnv(),
    });
    const init = run.frames.find((f) => f.kind === 'init');
    assert.ok(init, `no init frame (exit ${run.code}): ${run.stderr}`);
    assert.deepEqual(init.mcpServers.map((s) => [s.name, s.status]), [['openagents-workspace', 'connected']]);
    assert.equal(init.model, 'performance');
    assert.equal(init.permissionMode, 'bypassPermissions');
    assert.deepEqual(fs.readFileSync(mcpLog, 'utf-8').trim().split('\n'), ['workspace']);
    // Signed out, which the adapter must read off is_error, not the subtype.
    const verdict = verdictOf(run);
    assert.equal(verdict.kind, 'auth');
    assert.match(verdict.userMessage, new RegExp(`${edition.bin} login`));
  });

  it('leaves the project directory and the shell rc files untouched', () => {
    assert.deepEqual(fs.readdirSync(project), []);
    for (const rc of ['.zshrc', '.zshenv', '.zprofile', '.bashrc', '.profile']) {
      assert.equal(fs.existsSync(path.join(home, rc)), false, `${rc} was written`);
    }
  });

  it('reports a rejected token from stderr', async () => {
    const run = await runCli({ args: buildQoderArgs({}), env: baseEnv({ pat: 'not-a-real-token-123456' }) });
    assert.equal(run.frames.length, 0);
    assert.match(run.stderr, /QoderAuthError/);
    const verdict = verdictOf(run);
    assert.equal(verdict.kind, 'auth');
    assert.match(verdict.userMessage, new RegExp(editionVar(edition, 'PERSONAL_ACCESS_TOKEN')));
  });

  it('reports a resume it cannot find', async () => {
    const run = await runCli({ args: buildQoderArgs({ resumeSessionId: '11111111-2222-3333-4444-555555555555' }), env: baseEnv() });
    assert.equal(run.code, 42);
    assert.equal(verdictOf(run).kind, 'stale_session');
  });
});
