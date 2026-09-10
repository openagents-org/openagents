const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildOpenCodeSystemPrompt, buildWindowsShellHint } = require('../src/adapters/workspace-prompt');

const BASE = { agentName: 'oc', workspaceId: 'ws', channelName: 'general', endpoint: 'https://x', token: 't' };

describe('Windows shell hint (OpenCode)', () => {
  it('is included in the OpenCode system prompt on Windows only', () => {
    assert.match(buildOpenCodeSystemPrompt({ ...BASE, isWindows: true }), /## Shell on Windows/);
    assert.doesNotMatch(buildOpenCodeSystemPrompt({ ...BASE, isWindows: false }), /Shell on Windows/);
  });

  it('steers away from multi-line PowerShell and towards the file tools', () => {
    const hint = buildWindowsShellHint(true);
    assert.match(hint, /ONE line/);
    assert.match(hint, /here-strings/);
    assert.match(hint, /write\/edit tools/);
    assert.equal(buildWindowsShellHint(false), '');
  });
});
