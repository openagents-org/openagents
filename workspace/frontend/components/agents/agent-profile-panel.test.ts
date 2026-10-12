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
// The real Select mounts its items only once opened; rendered flat, the
// options a test expects are simply in the document.
vi.mock('@/components/ui/select', async () => {
  const { createElement } = await import('react');
  const flat = ({ children }: { children?: React.ReactNode }) => createElement('div', null, children);
  return {
    Select: flat,
    SelectContent: flat,
    SelectTrigger: flat,
    SelectValue: () => null,
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) =>
      createElement('div', { 'data-option': value }, children),
  };
});

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

  const catalog = {
    name: 'codex',
    models: [{ id: 'gpt-catalog', label: 'GPT Catalog', category: 'chat' }],
    models_provider: 'openai',
    workspace_model: true,
  };
  const hostedOn = (agent: Record<string, unknown>) => [{
    nodeId: 'n1',
    agents: [{ name: 'codex-demo-key', type: 'codex', status: 'running', ...agent }],
  }];
  const options = () => Array.from(container.querySelectorAll('[data-option]'))
    .map((el) => el.getAttribute('data-option'));

  it('offers a signed-in agent the models its own CLI lists for the account', async () => {
    api.getAgentCatalogDetail.mockResolvedValue(catalog);
    api.listNodes.mockResolvedValue(hostedOn({
      baseUrlHost: null,
      cliModels: [{ id: 'gpt-6-astra', label: 'GPT-6-Astra' }, { id: 'gpt-5.5', label: 'GPT-5.5' }],
    }));

    await renderPanel();

    expect(options()).toEqual(['__default__', 'gpt-6-astra', 'gpt-5.5']);
    expect(container.textContent).toContain('GPT-6-Astra');
    expect(container.textContent).toContain('agents.modelAccountHint');
  });

  it('keeps the catalog list when the node reports none for the agent', async () => {
    api.getAgentCatalogDetail.mockResolvedValue(catalog);
    // An older launcher sends no cliModels; a current one sends null for an
    // agent on a key, or one whose CLI has not answered yet.
    api.listNodes.mockResolvedValue(hostedOn({ baseUrlHost: null, cliModels: null }));

    await renderPanel();

    expect(options()).toEqual(['__default__', 'gpt-catalog']);
    expect(container.textContent).not.toContain('agents.modelAccountHint');
  });
});
