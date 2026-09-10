'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { AgentConnector } = require('../src/index');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-index-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AgentConnector instance env', () => {
  it('merges type env with instance env without cross-agent overwrite', () => {
    const connector = new AgentConnector({ configDir: tmpDir });
    connector.saveAgentEnv('opencode', {
      LLM_API_KEY: 'sk-test',
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      LLM_MODEL: 'default-model',
    });

    connector.addAgent({ name: 'agent-a', type: 'opencode', role: 'worker' });
    connector.addAgent({ name: 'agent-b', type: 'opencode', role: 'worker' });

    connector.saveAgentInstanceEnv('agent-a', { LLM_MODEL: 'model-a' });
    connector.saveAgentInstanceEnv('agent-b', { LLM_MODEL: 'model-b' });

    const agents = connector.listAgents();
    const agentA = agents.find((agent) => agent.name === 'agent-a');
    const agentB = agents.find((agent) => agent.name === 'agent-b');

    assert.equal(agentA.env.LLM_MODEL, 'model-a');
    assert.equal(agentB.env.LLM_MODEL, 'model-b');
    assert.equal(agentA.env.LLM_BASE_URL, 'https://openrouter.ai/api/v1');
    assert.equal(agentB.env.LLM_BASE_URL, 'https://openrouter.ai/api/v1');
    assert.deepEqual(connector.getAgentInstanceEnv('agent-a'), { LLM_MODEL: 'model-a' });
    assert.deepEqual(connector.getAgentInstanceEnv('agent-b'), { LLM_MODEL: 'model-b' });
  });
});

describe('AgentConnector display names', () => {
  /** Stand in for the workspace half so no network is involved. */
  function stubWorkspace(connector, impl) {
    connector._workspaceClientFor = () => ({
      client: impl,
      network: { id: 'ws-1', token: 't' },
    });
  }

  it('keeps `name` as the identity and stores the label beside it', () => {
    const connector = new AgentConnector({ configDir: tmpDir });
    connector.addAgent({ name: 'copilot-jade-robin', type: 'copilot' });
    connector._workspaceClientFor = () => null; // local-only agent

    return connector.setAgentDisplayName('copilot-jade-robin', 'My Copilot')
      .then(() => {
        const [agent] = connector.config.getAgents();
        // The identity is what keys the working dir, sessions and membership.
        assert.equal(agent.name, 'copilot-jade-robin');
        assert.equal(agent.display_name, 'My Copilot');
        assert.equal(connector.listAgents()[0].displayName, 'My Copilot');
      });
  });

  it('pushes the label to the workspace before writing it locally', async () => {
    const connector = new AgentConnector({ configDir: tmpDir });
    connector.addAgent({ name: 'a1', type: 'copilot' });
    const calls = [];
    stubWorkspace(connector, {
      setMemberDisplayName: async (ws, token, name, label) => {
        calls.push({ ws, name, label });
      },
    });

    await connector.setAgentDisplayName('a1', 'Renamed');
    assert.deepEqual(calls, [{ ws: 'ws-1', name: 'a1', label: 'Renamed' }]);
    assert.equal(connector.config.getAgent('a1').display_name, 'Renamed');
  });

  it('leaves both sides unchanged when the workspace rejects the label', async () => {
    // The workspace refuses a label another member already answers to (it
    // doubles as an @-mention alias). Writing locally anyway would leave the
    // two sides permanently disagreeing about what this agent is called.
    const connector = new AgentConnector({ configDir: tmpDir });
    connector.addAgent({ name: 'a1', type: 'copilot' });
    stubWorkspace(connector, {
      setMemberDisplayName: async () => {
        throw new Error('Display name conflicts with another member');
      },
    });

    await assert.rejects(() => connector.setAgentDisplayName('a1', 'Taken'));
    assert.equal(connector.config.getAgent('a1').display_name, undefined);
  });

  it('clears the label back to nothing on an empty value', async () => {
    const connector = new AgentConnector({ configDir: tmpDir });
    connector.addAgent({ name: 'a1', type: 'copilot' });
    connector._workspaceClientFor = () => null;

    await connector.setAgentDisplayName('a1', 'Something');
    await connector.setAgentDisplayName('a1', '   ');
    // Cleared, not deleted: the key round-trips through YAML as null rather
    // than disappearing. What matters is that nothing downstream reads it as a
    // label — listAgents reports null and the UI falls back to `name`.
    assert.ok(!connector.config.getAgent('a1').display_name);
    assert.equal(connector.listAgents()[0].displayName, null);
  });
});

describe('AgentConnector workspace removal', () => {
  it('drops the member row, and is a no-op for a local-only agent', async () => {
    const connector = new AgentConnector({ configDir: tmpDir });
    connector.addAgent({ name: 'local-only', type: 'copilot' });
    connector._workspaceClientFor = () => null;

    const res = await connector.removeAgentFromWorkspace('local-only');
    assert.equal(res.skipped, true);
    // Nothing over there to remove, and the agent is untouched here.
    assert.equal(connector.config.getAgent('local-only').name, 'local-only');
  });

  it('treats a 404 as done — the member row is already gone', async () => {
    // Removal is local-LAST, so a failure here means the agent cannot be
    // removed at all. A workspace that has since been deleted, or a member
    // someone already removed over there, would otherwise strand it here
    // forever with no way to clean it up.
    const connector = new AgentConnector({ configDir: tmpDir });
    connector.addAgent({ name: 'a1', type: 'copilot' });
    connector._workspaceClientFor = () => ({
      client: {
        removeMember: async () => {
          const e = new Error('Member not found');
          e.status = 404;
          throw e;
        },
      },
      network: { id: 'ws-1', token: 't' },
    });

    const res = await connector.removeAgentFromWorkspace('a1');
    assert.equal(res.alreadyGone, true);
  });

  it('still refuses on a transient failure, so nothing is lost silently', async () => {
    const connector = new AgentConnector({ configDir: tmpDir });
    connector.addAgent({ name: 'a1', type: 'copilot' });
    connector._workspaceClientFor = () => ({
      client: {
        removeMember: async () => {
          const e = new Error('Bad gateway');
          e.status = 502;
          throw e;
        },
      },
      network: { id: 'ws-1', token: 't' },
    });

    await assert.rejects(() => connector.removeAgentFromWorkspace('a1'));
    // The agent is untouched here, so the user can retry.
    assert.equal(connector.config.getAgent('a1').name, 'a1');
  });

  it('keeps removeAgent synchronous so its callers keep working', () => {
    // `agn remove` and the TUI call this without awaiting, inside a try/catch.
    // Making it async would turn a throw into an unhandled rejection they can
    // no longer see, so the network half lives in removeAgentFromWorkspace.
    const connector = new AgentConnector({ configDir: tmpDir });
    connector.addAgent({ name: 'a1', type: 'copilot' });
    const result = connector.removeAgent('a1');
    assert.equal(typeof result.then, 'undefined');
    assert.equal(connector.config.getAgents().length, 0);
  });
});
