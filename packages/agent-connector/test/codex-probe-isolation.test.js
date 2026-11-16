'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { codexProbeArgs, classifyFailure, failureMessage, CODE } = require('../src/probe');

const BASE = ['exec', '--skip-git-repo-check', 'hi'];

function codexHome(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-probe-'));
  if (config != null) fs.writeFileSync(path.join(dir, 'config.toml'), config);
  return dir;
}

describe('codexProbeArgs', () => {
  it('turns off hooks and the ChatGPT apps connector, after the subcommand', () => {
    const args = codexProbeArgs(BASE, { CODEX_HOME: codexHome(null) });
    assert.deepEqual(args, ['exec', '-c', 'features.hooks=false', '-c', 'features.apps=false', '--skip-git-repo-check', 'hi']);
  });

  it("turns off each of the user's MCP servers by name", () => {
    const home = codexHome([
      'model = "gpt-5.5"',
      '[mcp_servers.figma]',
      'url = "https://mcp.figma.com/mcp"',
      '[mcp_servers.figma.http_headers]',
      'X = "1"',
      '  [ mcp_servers.local-db ]',
      'command = "db-mcp"',
      '[mcp_servers."has space"]',
      'command = "x"',
      '[profiles.fast]',
    ].join('\n'));
    const args = codexProbeArgs(BASE, { CODEX_HOME: home });
    const overrides = args.filter((a, i) => args[i - 1] === '-c');
    assert.deepEqual(overrides, [
      'features.hooks=false',
      'features.apps=false',
      'mcp_servers.figma.enabled=false',
      'mcp_servers.local-db.enabled=false',
    ]);
    // Nothing that would need quoting through a Windows shell.
    assert.ok(args.every((a) => !/[\s"']/.test(a)));
    assert.equal(args[args.length - 1], 'hi');
  });
});

describe('codex probe failures', () => {
  it('reads "waiting for network" as a network problem', () => {
    const out = 'ERROR: Reconnecting... waiting for network\nERROR: Reconnecting... waiting for network';
    assert.equal(classifyFailure(out, { timedOut: true }), CODE.NETWORK);
  });

  it('does not quote the codex exec banner as the reason', () => {
    const stderr = [
      'Reading additional input from stdin...',
      'OpenAI Codex v0.165.0',
      '--------',
      'workdir: /Users/someone',
      'model: gpt-5.6-sol',
      'provider: openai',
      'approval: never',
      'sandbox: read-only',
      'reasoning effort: medium',
      'reasoning summaries: none',
      'session id: 01a1dd52-9fa5-73f0-bc8f-40374533aaaa',
      '--------',
      'user',
      'hi',
    ].join('\n');
    assert.equal(failureMessage({ code: 1, stdout: '', stderr, timedOut: true }, CODE.TIMEOUT, 120000), 'Timed out after 120s');
  });

  it('keeps a model line that says something', () => {
    const stderr = 'OpenAI Codex v0.165.0\nmodel: gpt-x is not available on this account';
    const msg = failureMessage({ code: 1, stdout: '', stderr }, CODE.CLI_ERROR, 120000);
    assert.ok(msg.includes('gpt-x is not available'), msg);
  });
});

describe('codexProbeArgs leaves other shapes alone', () => {
  it('only rewrites a `codex exec` probe', () => {
    const args = ['-e', 'console.log(1)'];
    assert.equal(codexProbeArgs(args, { CODEX_HOME: codexHome(null) }), args);
  });
});
