// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceProvider, useWorkspace } from './workspace-context';
import { clearWorkspaceSnapshots } from './workspace-snapshot';

const api = vi.hoisted(() => Object.fromEntries([
  'configure', 'getWorkspace', 'discover', 'listFiles', 'listTrash',
  'listBrowserTabs', 'listBrowserContexts', 'listTodos', 'listTasks',
  'listWorkflows', 'listRoutines', 'listKnowledge', 'listNotifications',
  'listConversations', 'latestPerChannel', 'listApprovals', 'sendAgentControl',
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
  clearWorkspaceSnapshots();
  for (const method of Object.values(api)) {
    method.mockReset().mockImplementation(() => new Promise(() => {}));
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function startStop() {
  essentials();
  await render();
  api.sendAgentControl.mockResolvedValue({});
  vi.useFakeTimers();
  await act(async () => state?.setSessionActive('general', true));
  expect(state?.activeSessionIds.has('general')).toBe(true);
  await act(async () => { await state?.stopAllAgents('general'); });
  expect(state?.stoppingSessionIds.has('general')).toBe(true);
  expect(api.sendAgentControl).toHaveBeenCalledWith('helper', 'stop', { channel: 'general' });
}

describe('workspace Stop', () => {
  it("keeps Stopping when the human's own message arrives", async () => {
    await startStop();
    await act(async () => state?.updateLastMessage('general', 'me', 'do something else', false, false));
    expect(state?.stoppingSessionIds.has('general')).toBe(true);
  });

  it("clears Stopping when an agent's message arrives", async () => {
    await startStop();
    await act(async () => state?.updateLastMessage('general', 'helper', 'Bash > ls', true, true));
    expect(state?.stoppingSessionIds.has('general')).toBe(true);
    await act(async () => state?.updateLastMessage('general', 'helper', 'Execution stopped by user.', false, true));
    expect(state?.stoppingSessionIds.has('general')).toBe(false);
  });

  it('restores the Stop button when the stop is never acknowledged', async () => {
    await startStop();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(api.sendAgentControl).toHaveBeenCalledTimes(2); // one retry
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(state?.stoppingSessionIds.has('general')).toBe(false);
    expect(state?.activeSessionIds.has('general')).toBe(true);
  });

  it('ignores a second click while the first stop is pending', async () => {
    await startStop();
    await act(async () => { await state?.stopAllAgents('general'); });
    expect(api.sendAgentControl).toHaveBeenCalledTimes(1);
  });
});
