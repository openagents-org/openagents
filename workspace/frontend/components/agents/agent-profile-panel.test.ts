// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentProfilePanel } from './agent-profile-panel';

const navigation = vi.hoisted(() => ({ setCurrentSessionId: vi.fn(), createSession: vi.fn() }));

const api = vi.hoisted(() => ({
  getAgentCatalogDetail: vi.fn(),
  listNodes: vi.fn(),
  getAgentDirectory: vi.fn(),
}));

const layout = vi.hoisted(() => ({ openEditAgent: vi.fn() }));
const owner = vi.hoisted(() => ({ email: 'owner@example.com' }));

vi.mock('@/lib/api', () => ({ workspaceApi: api }));
vi.mock('@/components/layout/layout-context', () => ({
  useLayout: () => ({
    selectedAgentName: 'codex-demo-key',
    setSelectedAgentName: vi.fn(),
    openEditAgent: layout.openEditAgent,
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
      nodeId: 'n1',
      ownerEmail: owner.email,
      workingDir: 'C:\\Users\\tester',
      description: null,
      enabledSkills: null,
      model: null,
      status: 'online',
      lastHeartbeatAt: null,
      joinedAt: null,
    }],
    refreshWorkspace: vi.fn(),
    ...navigation,
    currentUser: { id: 'owner@example.com', isAuthenticated: true },
  }),
}));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/hooks/use-me', () => ({ useMe: () => null }));
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
    SelectGroup: flat,
    SelectTrigger: flat,
    SelectValue: () => null,
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) =>
      createElement('div', { 'data-option': value }, children),
  };
});

// The profile opens as a sheet, which portals out of the render container,
// so queries look at the whole document.
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom has no ResizeObserver; Radix measures with it once the sheet opens.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.clearAllMocks();
  api.getAgentCatalogDetail.mockReset();
  api.listNodes.mockReset().mockResolvedValue([]);
  api.getAgentDirectory.mockReset().mockResolvedValue([]);
  owner.email = 'owner@example.com';
  layout.openEditAgent.mockReset();
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

  it('opens the agent direct message instead of creating a thread', async () => {
    api.getAgentCatalogDetail.mockResolvedValue({ name: 'codex', models: [] });
    await renderPanel();
    const button = Array.from(document.body.querySelectorAll('button'))
      .find((item) => item.textContent === 'agents.directMessage');
    expect(button).toBeDefined();
    await act(async () => button?.click());
    expect(navigation.setCurrentSessionId).toHaveBeenCalledWith(
      'dm:human:owner@example.com,openagents:codex-demo-key',
    );
    expect(navigation.createSession).not.toHaveBeenCalled();
  });

  it('keeps the model card visible and explains a catalog failure', async () => {
    api.getAgentCatalogDetail.mockRejectedValue(new Error('catalog unavailable'));

    await renderPanel();

    expect(document.body.textContent).toContain('agents.fieldModel');
    expect(document.body.textContent).toContain('catalog unavailable');
  });

  it('offers manual model entry when the catalog has no usable models', async () => {
    api.getAgentCatalogDetail.mockResolvedValue({
      name: 'codex', models: [], models_provider: 'openai', workspace_model: true,
    });

    await renderPanel();

    expect(document.body.querySelector('input[aria-label="agents.fieldModel"]')).not.toBeNull();
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
    const retry = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent === 'agents.modelRetry');
    expect(retry).toBeDefined();

    await act(async () => {
      retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.getAgentCatalogDetail).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain('catalog unavailable');
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
  const options = () => Array.from(document.body.querySelectorAll('[data-option]'))
    .map((el) => el.getAttribute('data-option'));

  it('offers a signed-in agent the models its own CLI lists for the account', async () => {
    api.getAgentCatalogDetail.mockResolvedValue(catalog);
    api.listNodes.mockResolvedValue(hostedOn({
      baseUrlHost: null,
      cliModels: [{ id: 'gpt-6-astra', label: 'GPT-6-Astra' }, { id: 'gpt-5.5', label: 'GPT-5.5' }],
    }));

    await renderPanel();

    expect(options()).toEqual(['__default__', 'gpt-6-astra', 'gpt-5.5']);
    expect(document.body.textContent).toContain('GPT-6-Astra');
    expect(document.body.textContent).toContain('agents.modelAccountHint');
  });

  it('keeps the catalog list when the node reports none for the agent', async () => {
    api.getAgentCatalogDetail.mockResolvedValue(catalog);
    // An older launcher sends no cliModels; a current one sends null for an
    // agent on a key, or one whose CLI has not answered yet.
    api.listNodes.mockResolvedValue(hostedOn({ baseUrlHost: null, cliModels: null }));

    await renderPanel();

    expect(options()).toEqual(['__default__', 'gpt-catalog']);
    expect(document.body.textContent).not.toContain('agents.modelAccountHint');
  });
});

describe('agent working folder', () => {
  it('shows the folder and its device, and sends a change to the full settings', async () => {
    api.getAgentCatalogDetail.mockResolvedValue({ name: 'codex', models: [], workspace_model: true });
    await act(async () => { root.render(React.createElement(AgentProfilePanel)); });
    await act(async () => { await Promise.resolve(); });

    expect(document.body.textContent).toContain('C:\\Users\\tester');
    expect(document.body.textContent).toContain('agents.workdirDevice');
    const edit = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent === 'agents.workdirEdit');
    expect(edit).toBeDefined();
    await act(async () => { edit?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(layout.openEditAgent).toHaveBeenCalledWith({ agentName: 'codex-demo-key', nodeId: 'n1' });
  });

  it('offers no change for an agent someone else owns', async () => {
    owner.email = 'someone-else@example.com';
    api.getAgentCatalogDetail.mockResolvedValue({ name: 'codex', models: [], workspace_model: true });
    await act(async () => { root.render(React.createElement(AgentProfilePanel)); });
    await act(async () => { await Promise.resolve(); });

    expect(document.body.textContent).toContain('C:\\Users\\tester');
    const edit = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent === 'agents.workdirEdit');
    expect(edit).toBeUndefined();
  });
});
