'use strict';

// OpenCode gets the workspace tools through our MCP server, and is told about
// them; without the server, its instructions name its real shell tool.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const OpenCodeAdapter = require('../src/adapters/opencode');
const { buildOpenCodeSystemPrompt, buildOpenCodeSkillMd } = require('../src/adapters/workspace-prompt');

function makeAdapter(env = {}) {
  const adapter = new OpenCodeAdapter({ workspaceId: 'ws', channelName: 'thread', token: 'tok', agentName: 'oc', agentEnv: env });
  adapter._log = () => {};
  return adapter;
}

describe('OpenCode workspace MCP', () => {
  it('adds the workspace server to the inline config, keeping the host\'s entries', () => {
    const host = { permission: { external_directory: 'deny' }, mcp: { search: { type: 'local', command: ['node', 's.cjs'], enabled: true } } };
    const env = makeAdapter({ PATH: '/bin', OPENCODE_CONFIG_CONTENT: JSON.stringify(host) })._spawnEnv('dm:human:a@b.c');
    const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
    assert.deepStrictEqual(cfg.permission, host.permission);
    assert.deepStrictEqual(cfg.mcp.search, host.mcp.search);
    const server = cfg.mcp.openagents;
    assert.strictEqual(server.type, 'local');
    assert.strictEqual(server.enabled, true);
    assert.strictEqual(server.command[0], process.execPath);
    assert.ok(server.command.includes('mcp-server'));
    assert.strictEqual(server.command[server.command.indexOf('--channel-name') + 1], 'dm:human:a@b.c');
    assert.strictEqual(server.environment.OA_WORKSPACE_TOKEN, 'tok');
  });

  it('leaves an unparseable host config alone', () => {
    const env = makeAdapter({ OPENCODE_CONFIG_CONTENT: '{nope' })._spawnEnv('thread');
    assert.strictEqual(env.OPENCODE_CONFIG_CONTENT, '{nope');
  });

  it('skips the server for an OpenCode across the WSL boundary', () => {
    const adapter = makeAdapter({});
    adapter._opencodeBinary = 'wsl:/home/u/.local/bin/opencode';
    assert.strictEqual(adapter._spawnEnv('thread').OPENCODE_CONFIG_CONTENT, undefined);
    assert.ok(!adapter._buildSystemContext('thread').includes('workspace_put_todos'));
  });

  it('describes the tools when wired, and curl through bash when not', () => {
    const base = { agentName: 'oc', workspaceId: 'ws', channelName: 'thread', endpoint: 'https://e', token: 'tok', disabledModules: new Set() };
    const mcp = buildOpenCodeSystemPrompt({ ...base, workspaceMcp: true });
    assert.ok(mcp.includes('workspace_publish_project'));
    assert.ok(!mcp.includes('X-Workspace-Token: tok'));
    const rest = buildOpenCodeSystemPrompt(base);
    assert.ok(rest.includes('Call your `bash` tool'));
    assert.ok(!rest.includes('`exec`'));
    assert.ok(buildOpenCodeSkillMd(base).includes('Call your `bash` tool'));
    assert.ok(makeAdapter({})._buildSystemContext('thread').includes('workspace_publish_project'));
  });
});
