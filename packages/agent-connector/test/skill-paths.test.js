'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ClaudeAdapter = require('../src/adapters/claude');
const OpenCodeAdapter = require('../src/adapters/opencode');
const OpenClawAdapter = require('../src/adapters/openclaw');

describe('adapter skill paths', () => {
  it('writes Claude skill as .claude/skills/openagents-workspace/SKILL.md', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-claude-skill-'));
    try {
      const adapter = new ClaudeAdapter({
        workspaceId: 'workspace-123',
        channelName: 'thread-abc',
        token: 'token-123',
        agentName: 'claude-agent',
        agentType: 'claude',
        workingDir: tmpDir,
        agentEnv: {},
        toolMode: 'skills',
      });
      adapter._findClaudeBinary = () => '/usr/bin/claude';

      adapter._buildClaudeCmd('prompt', 'thread-abc');

      const newPath = path.join(tmpDir, '.claude', 'skills', 'openagents-workspace', 'SKILL.md');
      const oldPath = path.join(tmpDir, '.claude', 'skills', 'openagents-workspace.md');
      assert.equal(fs.existsSync(newPath), true);
      assert.equal(fs.existsSync(oldPath), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('writes OpenCode skill as .opencode/skills/openagents-workspace/SKILL.md', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-opencode-skill-'));
    try {
      const agentName = `opencode-agent-${path.basename(tmpDir)}`;
      const adapter = new OpenCodeAdapter({
        workspaceId: 'workspace-123',
        channelName: 'thread-abc',
        token: 'token-123',
        agentName,
        agentType: 'opencode',
        agentEnv: {},
      });
      adapter.agentHome = tmpDir;

      adapter._ensureWorkspaceSkill('thread-abc');

      const newPath = path.join(tmpDir, '.opencode', 'skills', 'openagents-workspace', 'SKILL.md');
      const oldPath = path.join(tmpDir, '.opencode', 'skills', 'openagents-workspace.md');
      assert.equal(fs.existsSync(newPath), true);
      assert.equal(fs.existsSync(oldPath), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('writes OpenClaw skill to a fixed openagents-workspace directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-openclaw-skill-'));
    try {
      const adapter = new OpenClawAdapter({
        workspaceId: 'workspace-123',
        channelName: 'thread-abc',
        token: 'token-123',
        agentName: 'openclaw-agent',
        agentType: 'openclaw',
        agentEnv: {},
      });
      adapter._resolveOpenclawWorkspace = () => tmpDir;

      adapter._installWorkspaceSkill();

      const skillPath = path.join(tmpDir, 'skills', 'openagents-workspace', 'SKILL.md');
      const agentSpecificPath = path.join(tmpDir, 'skills', 'openagents-workspace-openclaw-agent', 'SKILL.md');
      assert.equal(fs.existsSync(skillPath), true);
      assert.equal(fs.existsSync(agentSpecificPath), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
