// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentProfilePanel } from './agent-profile-panel';

const api = vi.hoisted(() => ({
  getAgentCatalogDetail: vi.fn(),
  listNodes: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ workspaceApi: api }));
vi.mock('@/components/layout/layout-context', () => ({
  useLayout: () => ({
    selectedAgentName: 'codex-demo-key',
    setSelectedAgentName: vi.fn(),
    isMobile: false,
    setViewMode: vi.fn(),
    openMobileDetail: false,
  }),
}));
vi.mock('@/lib/workspace-context', () => ({
  useWorkspace: () => ({
    agents: [{
      agentName: 'codex-demo-key',
      displayName: null,
      role: 'member',
      agentType: 'codex',
      serverHost: 'DESKTOP-TEST',
      workingDir: 'C:\\Users\\tester',
      description: null,
      enabledSkills: null,
      model: null,
      status: 'online',
      lastHeartbeatAt: null,
      joinedAt: null,
    }],
    refreshWorkspace: vi.fn(),
    createSession: vi.fn(),
  }),
}));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({ isCopied: false, copyToClipboard: vi.fn() }),
}));
vi.mock('@/components/agents/agent-avatar', () => ({ AgentAvatar: () => null }));
vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values?.error ? `${key}: ${values.error}` : key,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.getAgentCatalogDetail.mockReset();
  api.listNodes.mockReset().mockResolvedValue([]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('agent model settings', () => {
  async function renderPanel() {
    await act(async () => {
      root.render(React.createElement(AgentProfilePanel));
    });
    await act(async () => { await Promise.resolve(); });
  }

  it('keeps the model card visible and explains a catalog failure', async () => {
    api.getAgentCatalogDetail.mockRejectedValue(new Error('catalog unavailable'));

    await renderPanel();

    expect(container.textContent).toContain('agents.fieldModel');
    expect(container.textContent).toContain('catalog unavailable');
  });

  it('offers manual model entry when the catalog has no usable models', async () => {
    api.getAgentCatalogDetail.mockResolvedValue({
      name: 'codex', models: [], models_provider: 'openai', workspace_model: true,
    });

    await renderPanel();

    expect(container.querySelector('input[aria-label="agents.fieldModel"]')).not.toBeNull();
  });

  it('retries catalog loading after an error', async () => {
    api.getAgentCatalogDetail
      .mockRejectedValueOnce(new Error('catalog unavailable'))
      .mockResolvedValueOnce({
        name: 'codex',
        models: [{ id: 'gpt-test', label: 'GPT Test', category: 'chat' }],
        models_provider: 'openai',
        workspace_model: true,
      });

    await renderPanel();
    const retry = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'agents.modelRetry');
    expect(retry).toBeDefined();

    await act(async () => {
      retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.getAgentCatalogDetail).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('catalog unavailable');
  });
});
