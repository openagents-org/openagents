import { describe, expect, it } from 'vitest';

import { withAgentDisplayNames } from './node-agent-labels';
import type { WorkspaceNode } from './types';

const node = (agents: WorkspaceNode['agents']) => ({ nodeId: 'n1', agents }) as WorkspaceNode;

describe('withAgentDisplayNames', () => {
  it('labels a renamed agent with its workspace display name', () => {
    const [out] = withAgentDisplayNames([node([{ name: 'kimi', type: 'kimi', status: 'online' }])], [{ agentName: 'kimi', displayName: 'kimi3' }]);
    expect(out.agents[0].displayName).toBe('kimi3');
  });

  it('clears a label the workspace no longer has', () => {
    const [out] = withAgentDisplayNames([node([{ name: 'kimi', displayName: 'old', type: 'kimi', status: 'online' }])], [{ agentName: 'kimi', displayName: '' }]);
    expect(out.agents[0].displayName).toBeNull();
  });

  it('keeps agents the workspace does not know and returns unchanged nodes as-is', () => {
    const input = node([{ name: 'local', displayName: 'Mine', type: 'codex', status: 'online' }]);
    const [out] = withAgentDisplayNames([input], [{ agentName: 'kimi', displayName: 'kimi3' }]);
    expect(out).toBe(input);
  });
});
