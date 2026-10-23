// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceProvider, useWorkspace } from './workspace-context';
import { ApiError } from './api';

const api = vi.hoisted(() => Object.fromEntries([
  'configure', 'getWorkspace', 'discover', 'listFiles', 'listTrash',
  'listBrowserTabs', 'listBrowserContexts', 'listTodos', 'listTasks',
  'listWorkflows', 'listRoutines', 'listKnowledge', 'listNotifications',
  'listConversations', 'latestPerChannel', 'listApprovals',
].map((name) => [name, vi.fn()])));

vi.mock('./api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api')>(), workspaceApi: api,
}));
vi.mock('./analytics', () => ({ capture: vi.fn(), group: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('./openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ user: null }) }));
vi.mock('@/hooks/use-me', () => ({ useMe: () => null }));
vi.mock('./identity', () => ({
  getStoredIdentity: () => ({ id: '', name: '' }),
  generateUserId: () => '', storeIdentity: vi.fn(),
}));
vi.mock('@/hooks/use-upload-queue', () => ({
  useUploadQueue: () => ({ uploads: [], enqueueUploads: vi.fn(), retryUpload: vi.fn(), cancelUpload: vi.fn() }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useWorkspace> | undefined;

function View() {
  state = useWorkspace();
  return React.createElement('div', null, state.loading ? 'Loading' : state.error || state.workspace?.name);
}

async function render(workspaceId = 'one', bearerToken?: string) {
  await act(async () => {
    root.render(React.createElement(WorkspaceProvider, {
      workspaceId, token: 'test-token', bearerToken, children: React.createElement(View),
    }));
  });
}

function essentials(name = 'Workspace one') {
  api.getWorkspace.mockResolvedValue({ name });
  api.discover.mockResolvedValue({
    agents: [{ address: 'openagents:helper', role: 'member', status: 'online' }],
    channels: [{ address: 'channel/general', title: 'General', participants: ['helper'], last_event_at: 1 }],
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Node's native localStorage can shadow jsdom's storage in newer runtimes.
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  state = undefined;
  for (const method of Object.values(api)) {
    method.mockReset().mockImplementation(() => new Promise(() => {}));
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('workspace initial loading', () => {
  it('shows the workspace, agents and threads while optional requests and previews are still pending', async () => {
    essentials();
    const tabs = deferred<{ tabs: unknown[] }>();
    api.listBrowserTabs.mockReturnValue(tabs.promise);
    await render();

    expect(container.textContent).toBe('Workspace one');
    expect(state?.loading).toBe(false);
    expect(state?.agents[0].agentName).toBe('helper');
    expect(state?.sessions[0].sessionId).toBe('general');
    expect(api.latestPerChannel).toHaveBeenCalledOnce();
    expect(state?.browserTabs).toEqual([]);

    await act(async () => tabs.resolve({ tabs: [{ id: 'tab-one', title: 'Browser' }] }));
    expect(state?.browserTabs[0].id).toBe('tab-one');
    expect(state?.loading).toBe(false);
  });

  it('keeps optional failures out of the workspace error state', async () => {
    essentials();
    api.listBrowserTabs.mockRejectedValue(new Error('Browser unavailable'));
    api.latestPerChannel.mockRejectedValue(new Error('Previews unavailable'));
    await render();
    expect(container.textContent).toBe('Workspace one');
    expect(state?.error).toBeNull();
  });

  it('waits for essential discovery and shows an essential failure, then recovers on a new workspace', async () => {
    essentials();
    const discovery = deferred<unknown>();
    api.discover.mockReturnValue(discovery.promise);
    await render();
    expect(container.textContent).toBe('Loading');
    expect(api.listBrowserTabs).not.toHaveBeenCalled();
    await act(async () => discovery.reject(new Error('Access denied')));
    expect(container.textContent).toBe('Access denied');
    essentials('Workspace two');
    await render('two');
    expect(container.textContent).toBe('Workspace two');
    expect(state?.error).toBeNull();
  });

  it('reports a failed initial load and retries the full workspace and roster', async () => {
    essentials();
    api.discover.mockRejectedValueOnce(new Error('Service busy'));
    await render();
    expect(state?.workspaceLoadError).toEqual({ message: 'Service busy', status: null });
    expect(state?.agents).toEqual([]);
    await act(async () => state?.retryWorkspace());
    expect(state?.workspaceLoadError).toBeNull();
    expect(state?.workspace?.name).toBe('Workspace one');
    expect(state?.agents[0].agentName).toBe('helper');
    expect(state?.sessions[0].sessionId).toBe('general');
    expect(api.getWorkspace).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404, 503])('preserves HTTP %s and recovers after changing identity on the same link', async (status) => {
    essentials();
    api.discover.mockRejectedValueOnce(new ApiError(status, '{"message":"Denied"}'));
    await render('one', 'old-identity');
    expect(state?.workspaceLoadError?.status).toBe(status);
    expect(api.latestPerChannel).not.toHaveBeenCalled();

    await render('one', 'new-identity');
    expect(api.configure).toHaveBeenLastCalledWith('one', 'test-token', 'new-identity');
    expect(state?.workspaceLoadError).toBeNull();
    expect(state?.workspace?.name).toBe('Workspace one');
    expect(api.discover).toHaveBeenCalledTimes(2);
  });

  it('clears old optional data and ignores late responses after switching workspaces', async () => {
    essentials();
    const oldTabs = deferred<{ tabs: unknown[] }>();
    const oldPreviews = deferred<unknown>();
    api.listBrowserTabs.mockReturnValueOnce(oldTabs.promise);
    api.latestPerChannel.mockReturnValueOnce(oldPreviews.promise);
    api.listTodos.mockResolvedValueOnce({ todos: [{ id: 'old-todo' }] });
    await render();
    expect(state?.todos).toHaveLength(1);

    essentials('Workspace two');
    await render('two');
    expect(state?.todos).toEqual([]);
    await act(async () => {
      oldTabs.resolve({ tabs: [{ id: 'old-tab' }] });
      oldPreviews.resolve({ channels: { general: { source: 'openagents:old', payload: { content: 'Old preview' } } } });
    });
    expect(container.textContent).toBe('Workspace two');
    expect(state?.browserTabs).toEqual([]);
    expect(state?.lastMessageBySession).toEqual({});
    expect(localStorage.getItem('previews:one')).toBeNull();
  });
});
