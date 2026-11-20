import { describe, expect, it } from 'vitest';

import { withWorkspaceAgentInfo } from './node-agent-labels';
import type { WorkspaceNode } from './types';

const node = (agents: WorkspaceNode['agents']) => ({ nodeId: 'n1', agents }) as WorkspaceNode;

describe('withWorkspaceAgentInfo', () => {
  it('labels a renamed agent with its workspace display name', () => {
    const [out] = withWorkspaceAgentInfo([node([{ name: 'kimi', type: 'kimi', status: 'online' }])], [{ agentName: 'kimi', displayName: 'kimi3' }]);
    expect(out.agents[0].displayName).toBe('kimi3');
  });

  it('clears a label the workspace no longer has', () => {
    const [out] = withWorkspaceAgentInfo([node([{ name: 'kimi', displayName: 'old', type: 'kimi', status: 'online' }])], [{ agentName: 'kimi', displayName: '' }]);
    expect(out.agents[0].displayName).toBeNull();
  });

  it('keeps agents the workspace does not know and returns unchanged nodes as-is', () => {
    const input = node([{ name: 'local', displayName: 'Mine', type: 'codex', status: 'online' }]);
    const [out] = withWorkspaceAgentInfo([input], [{ agentName: 'kimi', displayName: 'kimi3' }]);
    expect(out).toBe(input);
  });

  it('shows the model picked in the workspace over the device default', () => {
    const [out] = withWorkspaceAgentInfo(
      [node([{ name: 'codex', type: 'codex', status: 'running', model: null }])],
      [{ agentName: 'codex', model: 'gpt-6-sol' }],
    );
    expect(out.agents[0].model).toBe('gpt-6-sol');
  });

  it('keeps the device model when the workspace picked none', () => {
    const [out] = withWorkspaceAgentInfo(
      [node([{ name: 'codex', type: 'codex', status: 'running', model: 'gpt-5' }])],
      [{ agentName: 'codex', model: null }],
    );
    expect(out.agents[0].model).toBe('gpt-5');
  });
});
