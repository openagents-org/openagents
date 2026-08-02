'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BaseAdapter = require('../src/adapters/base');
const ClaudeAdapter = require('../src/adapters/claude');
const { buildPhaseGateDirective } = require('../src/adapters/workspace-prompt');

function makeAdapter(agentName = 'rd') {
  return new BaseAdapter({
    workspaceId: 'ws-1',
    channelName: 'session-1',
    token: 't',
    agentName,
    endpoint: 'https://example.test',
  });
}

function makeMsg(metadata, { content = 'build the sync module', channel = 'session-1' } = {}) {
  return {
    messageId: 'm-1',
    sessionId: channel,
    senderType: 'human',
    senderName: 'user',
    content,
    mentions: [],
    messageType: 'chat',
    metadata,
  };
}

describe('buildPhaseGateDirective', () => {
  it('returns nothing without a role', () => {
    assert.equal(buildPhaseGateDirective({}), '');
    assert.equal(buildPhaseGateDirective({ role: null }), '');
  });

  it('forbids building in the plan role and names the owner', () => {
    const text = buildPhaseGateDirective({ role: 'plan', owner: 'pm' });
    assert.match(text, /PLAN mode/);
    assert.match(text, /Do NOT start the work/);
    assert.match(text, /pm/);
  });

  it('tells the owner how to advance the phase', () => {
    const text = buildPhaseGateDirective({
      role: 'owner',
      owner: 'pm',
      endpoint: 'https://example.test/',
      workspaceId: 'ws-1',
      channelName: 'session-1',
    });
    assert.match(text, /workspace_set_phase/);
    assert.match(text, /phase="building"/);
    // Trailing slash on the endpoint must not double up in the fallback URL.
    assert.match(text, /https:\/\/example\.test\/v1\/workspaces\/ws-1\/channels\/session-1/);
  });

  it('omits the REST fallback when the adapter has no endpoint context', () => {
    const text = buildPhaseGateDirective({ role: 'owner', owner: 'pm' });
    assert.match(text, /workspace_set_phase/);
    assert.doesNotMatch(text, /PATCH/);
  });

  it('states the phase for a member that is neither owner nor gated', () => {
    const text = buildPhaseGateDirective({ role: 'member', owner: 'pm' });
    assert.match(text, /still being clarified/);
    assert.doesNotMatch(text, /PLAN mode/);
  });
});

describe('BaseAdapter phase role', () => {
  it('is null when the channel is not clarifying', () => {
    const a = makeAdapter();
    assert.equal(a._phaseRole(makeMsg({})), null);
    assert.equal(a._phaseRole(makeMsg({ phase: 'building', phase_owner: 'pm' })), null);
    assert.equal(a._phaseRole({ content: 'x' }), null);
  });

  it('is plan when this agent was gated', () => {
    const a = makeAdapter('rd');
    const msg = makeMsg({ phase: 'clarifying', phase_owner: 'pm', target_modes: { rd: 'plan' } });
    assert.equal(a._phaseRole(msg), 'plan');
  });

  it('is owner for the phase owner', () => {
    const a = makeAdapter('pm');
    const msg = makeMsg({ phase: 'clarifying', phase_owner: 'pm' });
    assert.equal(a._phaseRole(msg), 'owner');
  });

  it('is member for another agent in a gated channel', () => {
    const a = makeAdapter('qa');
    const msg = makeMsg({ phase: 'clarifying', phase_owner: 'pm', target_modes: { rd: 'plan' } });
    assert.equal(a._phaseRole(msg), 'member');
  });

  it('does not read another agent\'s gate as its own', () => {
    const a = makeAdapter('qa');
    const msg = makeMsg({ phase: 'clarifying', phase_owner: 'pm', target_modes: { rd: 'plan' } });
    assert.notEqual(a._phaseRole(msg), 'plan');
  });
});

describe('BaseAdapter._applyPhaseGate', () => {
  it('leaves an ungated message untouched', () => {
    const a = makeAdapter();
    const msg = makeMsg({});
    assert.equal(a._applyPhaseGate(msg), msg);
  });

  it('appends the directive after the user content, never before', () => {
    const a = makeAdapter('rd');
    const msg = makeMsg({ phase: 'clarifying', phase_owner: 'pm', target_modes: { rd: 'plan' } });
    const gated = a._applyPhaseGate(msg);
    assert.ok(gated.content.startsWith('build the sync module'));
    assert.match(gated.content, /Do NOT start the work/);
  });

  it('does not mutate the original message', () => {
    const a = makeAdapter('rd');
    const msg = makeMsg({ phase: 'clarifying', phase_owner: 'pm', target_modes: { rd: 'plan' } });
    a._applyPhaseGate(msg);
    assert.equal(msg.content, 'build the sync module');
  });
});

describe('BaseAdapter mode override', () => {
  it('defaults to the agent mode', () => {
    const a = makeAdapter();
    assert.equal(a._modeFor('session-1'), 'execute');
  });

  it('runs a gated message in plan mode and restores afterwards', async () => {
    const a = makeAdapter('rd');
    const seen = [];
    a._handleMessage = async (m) => { seen.push(a._modeFor(m.sessionId)); };

    const gated = makeMsg({ phase: 'clarifying', phase_owner: 'pm', target_modes: { rd: 'plan' } });
    await a._runMessage('session-1', gated);
    await a._runMessage('session-1', makeMsg({}));

    assert.deepEqual(seen, ['plan', 'execute']);
    assert.equal(a._modeFor('session-1'), 'execute');
  });

  it('clears the override even when the handler throws', async () => {
    const a = makeAdapter('rd');
    a._handleMessage = async () => { throw new Error('boom'); };
    const gated = makeMsg({ phase: 'clarifying', phase_owner: 'pm', target_modes: { rd: 'plan' } });
    await assert.rejects(() => a._runMessage('session-1', gated), /boom/);
    assert.equal(a._modeFor('session-1'), 'execute');
  });

  it('keeps one channel\'s gate out of another channel', async () => {
    const a = makeAdapter('rd');
    let release;
    const started = new Promise((r) => { release = r; });
    a._handleMessage = async (m) => {
      if (m.sessionId === 'session-1') {
        release();
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    const gated = makeMsg(
      { phase: 'clarifying', phase_owner: 'pm', target_modes: { rd: 'plan' } },
      { channel: 'session-1' },
    );
    const running = a._runMessage('session-1', gated);
    await started;
    // While session-1 is gated, an unrelated channel keeps executing.
    assert.equal(a._modeFor('session-2'), 'execute');
    assert.equal(a._modeFor('session-1'), 'plan');
    await running;
  });
});

// ---------------------------------------------------------------------------
// The gate has to survive contact with the actual CLI invocation: a directive
// in the prompt is advice, the permission flags are enforcement. These assert
// on the argv the adapter would spawn, which is what the earlier tests (mode
// bookkeeping only) could not tell apart from a no-op.
// ---------------------------------------------------------------------------

function claudeAdapter(workDir, toolMode) {
  const adapter = new ClaudeAdapter({
    workspaceId: 'ws-1',
    channelName: 'session-1',
    token: 'tok',
    agentName: 'rd',
    workingDir: workDir,
    toolMode,
  });
  adapter._log = () => {};
  return adapter;
}

function withWorkDir(fn) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-phase-gate-'));
  try {
    return fn(workDir);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

describe('ClaudeAdapter honours the phase-gate plan override', () => {
  it('skills mode: gated channel gets plan permissions and no write tools', () => {
    withWorkDir((workDir) => {
      const adapter = claudeAdapter(workDir, 'skills');
      adapter._modeOverrides['session-1'] = 'plan';

      const cmd = [];
      adapter._buildSkillsCmd(cmd, 'session-1');

      assert.ok(cmd.includes('--permission-mode'), 'must pass --permission-mode');
      assert.equal(cmd[cmd.indexOf('--permission-mode') + 1], 'plan');
      assert.ok(!cmd.includes('--dangerously-skip-permissions'));
      assert.ok(!cmd.includes('Write'));
      assert.ok(!cmd.includes('Edit'));
    });
  });

  it('skills mode: an ungated channel still runs with write tools', () => {
    withWorkDir((workDir) => {
      const adapter = claudeAdapter(workDir, 'skills');
      const cmd = [];
      adapter._buildSkillsCmd(cmd, 'session-1');

      assert.ok(cmd.includes('--dangerously-skip-permissions'));
      assert.ok(cmd.includes('Write'));
      assert.ok(!cmd.includes('--permission-mode'));
    });
  });

  it('mcp mode: gated channel gets plan permissions and no write MCP tools', () => {
    withWorkDir((workDir) => {
      const adapter = claudeAdapter(workDir, 'mcp');
      adapter._modeOverrides['session-1'] = 'plan';

      const cmd = [];
      adapter._buildMcpCmd(cmd, 'session-1');

      assert.equal(cmd[cmd.indexOf('--permission-mode') + 1], 'plan');
      assert.ok(!cmd.includes('--dangerously-skip-permissions'));
      assert.ok(!cmd.includes('Write'));
      assert.ok(!cmd.some((a) => a.endsWith('workspace_write_file')));
    });
  });

  it('the override is scoped to the gated channel only', () => {
    withWorkDir((workDir) => {
      const adapter = claudeAdapter(workDir, 'skills');
      adapter._modeOverrides['session-1'] = 'plan';

      const other = [];
      adapter._buildSkillsCmd(other, 'session-2');

      assert.ok(other.includes('--dangerously-skip-permissions'));
      assert.ok(other.includes('Write'));
    });
  });
});
