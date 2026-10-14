// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ instruct: vi.fn(), profile: vi.fn(), workspace: {
  currentSessionId: 'one', sessions: [{ sessionId: 'one', participants: ['scout'] }],
  agents: [{ agentName: 'scout', description: 'Research and verify sources', status: 'online' }, { agentName: 'other', description: 'Elsewhere' }],
  files: [{ id: 'image', filename: 'people/me/photo.png', contentType: 'image/png', size: 30, channelName: 'one' }, { id: 'hidden', filename: 'private.pdf', channelName: 'two' }],
  browserTabs: [{ id: 'live', title: 'XE', url: 'https://www.xe.com', status: 'active', artifactChannels: ['one'], activity: null }],
} }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => mocks.workspace }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => ({ selectedArtifact: null, setSelectedAgentName: mocks.profile }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, params?: any) => params?.agent ? `${key} ${params.agent}` : key }));
vi.mock('@/components/agents/agent-avatar', () => ({ AgentAvatar: () => null }));
vi.mock('@/components/files/file-utils', () => ({ FileTile: ({ file }: any) => React.createElement('img', { alt: file.filename }) }));
import { ThreadResources } from './thread-resources';
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(ThreadResources, { onInstruct: mocks.instruct })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('shows only participating agents and prepares instructions without sending', async () => {
  expect(host.textContent).toContain('Research and verify sources');
  expect(host.textContent).not.toContain('Elsewhere');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="threadResources.instructAgent scout"]')!.click());
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Check the exchange rate and cite sources');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(mocks.instruct).not.toHaveBeenCalled();
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.instruct).toHaveBeenCalledWith('scout', 'Check the exchange rate and cite sources');
});
it('switches to artifact cards and opens the correct browser', async () => {
  const artifacts = Array.from(host.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(el => el.textContent?.includes('artifactPanel.title'))!;
  await act(async () => artifacts.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
  expect(host.textContent).toContain('photo.png');
  expect(host.textContent).not.toContain('private.pdf');
  expect(host.querySelector('img')?.alt).toBe('people/me/photo.png');
  const row = host.querySelector<HTMLUListElement>('ul')!;
  row.scrollBy = vi.fn();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="threadResources.scrollRight"]')!.click());
  expect(row.scrollBy).toHaveBeenLastCalledWith({ left: 336, behavior: 'smooth' });
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="threadResources.scrollLeft"]')!.click());
  expect(row.scrollBy).toHaveBeenLastCalledWith({ left: -336, behavior: 'smooth' });
  const opened = vi.fn(); window.addEventListener('workspace:open-artifact', opened);
  try {
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(el => el.getAttribute('title') === 'XE')!.click());
    expect(opened.mock.calls[0][0].detail).toEqual({ kind: 'browser', id: 'live' });
  } finally { window.removeEventListener('workspace:open-artifact', opened); }
});
it('can collapse the shelf without losing the tab controls', async () => {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="threadResources.collapse"]')!.click());
  expect(host.querySelector('ul')).toBeNull();
  expect(host.querySelectorAll('[role=tab]')).toHaveLength(2);
});
