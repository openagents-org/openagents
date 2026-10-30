'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildToolDefs, McpServer } = require('../src/mcp-server');
const prompt = require('../src/adapters/workspace-prompt');

const removed = ['workspace_ask_owner', 'workspace_propose_improvement'];
const options = {
  endpoint: 'https://example.test', workspaceId: 'ws-1', token: 'test-token',
  channelName: 'general', agentName: 'test-agent', disabledModules: new Set(),
};

describe('approval tool surface', () => {
  it('keeps approval request and status tools without the removed escalation tools', () => {
    for (const disabled of [new Set(), new Set(['knowledge', 'files', 'browser'])]) {
      const names = buildToolDefs(disabled).map((tool) => tool.name);
      assert.ok(names.includes('workspace_request_approval'));
      assert.ok(names.includes('workspace_check_approval'));
      for (const name of removed) assert.ok(!names.includes(name));
    }
  });

  it('rejects calls to removed tools and still creates and checks approvals', async () => {
    let created = 0;
    let checked = 0;
    const server = new McpServer({
      ...options,
      wsClient: {
        async createApproval(workspaceId, token, body) {
          assert.equal(body.kind, 'deploy');
          assert.equal(body.channel, 'general');
          created++;
          return { id: 'approval-1', action: body.action, status: 'approved', resolved_by: 'policy' };
        },
        async getApproval(workspaceId, token, id) {
          assert.equal(id, 'approval-1');
          checked++;
          return { id, status: 'approved', action: 'Deploy', resolved_by: 'policy' };
        },
      },
    });
    for (const name of removed) await assert.rejects(server._dispatch(name, {}), /Unknown tool/);
    await server._dispatch('workspace_request_approval', { kind: 'deploy', action: 'Deploy' });
    await server._dispatch('workspace_check_approval', { approval_id: 'approval-1' });
    assert.equal(created, 1);
    assert.equal(checked, 1);
  });
});

describe('generated workspace instructions', () => {
  it('documents approval tools without removed escalation tools', () => {
    const text = prompt.buildClaudeMcpToolBlock();
    assert.match(text, /workspace_request_approval/);
    for (const name of removed) assert.ok(!text.includes(name));
  });
  for (const build of ['buildClaudeSkillMd', 'buildCursorSkillMd', 'buildOpenCodeSkillMd', 'buildOpenclawSkillMd']) {
    it(`${build} keeps approvals without help or proposal creation examples`, () => {
      const text = prompt[build](options);
      assert.match(text, /Request approval/);
      assert.match(text, /\/v1\/approvals/);
      assert.doesNotMatch(text, /"kind":"(?:help|proposal)"/);
      assert.doesNotMatch(text, /Ask your owner|Propose an improvement/);
      for (const name of removed) assert.ok(!text.includes(name));
    });
  }
});
