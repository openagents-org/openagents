import { describe, expect, it } from 'vitest';

import { buildNodeModelUpdate } from './helpers';
import { networkAgentToWorkspaceAgent } from './types';

describe('Workspace agent model selection', () => {
  it('builds a member update with the provider declared by the catalog option', () => {
    expect(buildNodeModelUpdate('deepseek/deepseek-v4-pro', [
      { id: 'deepseek/deepseek-v4-pro', provider: 'nous' },
    ])).toEqual({
      model: 'deepseek/deepseek-v4-pro',
      model_provider: 'nous',
    });
  });

  it('clears model and provider together when the default is selected', () => {
    expect(buildNodeModelUpdate('', [
      { id: 'deepseek/deepseek-v4-pro', provider: 'nous' },
    ])).toEqual({ model: '', model_provider: '' });
  });

  it('retains model_provider from discovery in the component-facing agent', () => {
    const agent = networkAgentToWorkspaceAgent({
      address: 'openagents:hermes',
      role: 'member',
      status: 'online',
      agent_type: 'hermes',
      server_host: 'device',
      working_dir: '/work',
      description: null,
      enabled_skills: null,
      model: 'deepseek/deepseek-v4-pro',
      model_provider: 'nous',
      last_heartbeat_at: null,
      joined_at: null,
    } as Parameters<typeof networkAgentToWorkspaceAgent>[0]);

    expect(agent.modelProvider).toBe('nous');
  });
});
