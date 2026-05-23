'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CursorAdapter = require('../src/adapters/cursor');

function makeAdapter(tmpDir) {
  const adapter = new CursorAdapter({
    workspaceId: 'workspace-123',
    channelName: 'thread-abc',
    token: 'token-123',
    agentName: 'cursor-agent',
    agentType: 'cursor',
    workingDir: tmpDir,
    agentEnv: {},
  });
  adapter._findCursorBinary = () => '/usr/bin/agent';
  return adapter;
}

describe('CursorAdapter', () => {
  it('writes the workspace skill as .cursor/skills/openagents-workspace/SKILL.md', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-cursor-'));
    try {
      const adapter = makeAdapter(tmpDir);
      adapter._writeSkillFile('thread-abc');

      const newPath = path.join(tmpDir, '.cursor', 'skills', 'openagents-workspace', 'SKILL.md');
      const oldPath = path.join(tmpDir, '.cursor', 'skills', 'openagents-workspace.md');
      assert.equal(fs.existsSync(newPath), true);
      assert.equal(fs.existsSync(oldPath), false);

      const skill = fs.readFileSync(newPath, 'utf-8');
      assert.ok(!skill.includes('workspace-123'));
      assert.ok(!skill.includes('token-123'));
      assert.ok(!skill.includes('cursor-agent'));
      assert.ok(skill.includes('$OA_WORKSPACE_TOKEN'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps normal Cursor prompts free of bootstrap context', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-cursor-'));
    try {
      const adapter = makeAdapter(tmpDir);

      const freshCmd = adapter._buildCursorCmd('do the task', 'thread-abc');
      const freshPrompt = freshCmd[freshCmd.indexOf('-p') + 1];
      assert.equal(freshPrompt, 'do the task');
      assert.ok(!freshPrompt.includes('OpenAgents Workspace Runtime Context'));

      adapter._channelSessions['thread-abc'] = 'cursor-session-id';
      const resumedCmd = adapter._buildCursorCmd('continue task', 'thread-abc');
      const resumedPrompt = resumedCmd[resumedCmd.indexOf('-p') + 1];
      assert.equal(resumedPrompt, 'continue task');
      assert.ok(resumedCmd.includes('--resume'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('builds a separate Cursor bootstrap prompt for session seeding', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-cursor-'));
    try {
      const adapter = makeAdapter(tmpDir);
      const cmd = adapter._buildCursorBootstrapCmd('thread-abc');
      const prompt = cmd[cmd.indexOf('-p') + 1];

      assert.ok(prompt.includes('thread-abc'));
      assert.ok(prompt.includes('cursor-agent'));
      assert.ok(!prompt.includes('do the task'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
