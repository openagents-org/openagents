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
vi.mock('@/components/artifacts/browser-thumbnail', () => ({ BrowserThumbnail: ({ tabId, pageUrl, enabled }: any) => React.createElement('span', { 'data-browser-thumbnail': tabId, 'data-url': pageUrl, 'data-enabled': enabled }) }));
vi.mock('@/components/files/file-utils', () => ({ FileTile: ({ file }: any) => React.createElement('img', { alt: file.filename }) }));
import { ThreadResources } from './thread-resources';
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(ThreadResources, { onInstruct: mocks.instruct })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('defaults to Artifacts first and lets users switch to agent cards to prepare instructions', async () => {
  const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('[role=tab]'));
  expect(tabs[0].textContent).toContain('artifactPanel.title');
  expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  await act(async () => tabs[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
  const row = host.querySelector<HTMLUListElement>('ul')!;
  expect(row.getAttribute('aria-label')).toBe('threadResources.agents');
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
  expect(host.querySelector('[data-browser-thumbnail=live]')?.getAttribute('data-url')).toBe('https://www.xe.com');
  expect(host.querySelector('[data-browser-thumbnail=live]')?.getAttribute('data-enabled')).toBe('true');
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

const pointer = (target: Element, type: string, x: number, options: { button?: number; buttons?: number; pointerType?: string } = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: options.button ?? 0, buttons: options.buttons ?? 1 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: options.pointerType ?? 'mouse' } });
  target.dispatchEvent(event);
};
const prepareDrag = (row: HTMLUListElement) => {
  let captured = false;
  row.setPointerCapture = vi.fn(() => { captured = true; });
  row.hasPointerCapture = vi.fn(() => captured);
  row.releasePointerCapture = vi.fn(() => { captured = false; });
  row.scrollLeft = 100;
};
it.each(['artifacts', 'agents'])('drags %s without opening a card, and preserves normal clicks', async section => {
  if (section === 'agents') await act(async () => host.querySelectorAll('[role=tab]')[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
  const row = host.querySelector<HTMLUListElement>('ul')!;
  const card = row.querySelector('button')!;
  prepareDrag(row);
  const opened = vi.fn(); window.addEventListener('workspace:open-artifact', opened);
  const action = section === 'agents' ? mocks.profile : opened;
  try {
    await act(async () => { pointer(card, 'pointerdown', 200); pointer(card, 'pointermove', 160); });
    expect(row.scrollLeft).toBe(140);
    expect(row.dataset.dragging).toBe('true');
    expect(row.style.scrollSnapType).toBe('none');
    await act(async () => {
      pointer(row, 'pointerup', 160, { buttons: 0 });
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(action).not.toHaveBeenCalled();
    expect(row.dataset.dragging).toBeUndefined();
    expect(row.style.scrollSnapType).toBe('');
    expect(row.releasePointerCapture).toHaveBeenCalledWith(1);
    await act(async () => {
      pointer(card, 'pointerdown', 160); pointer(card, 'pointermove', 162);
      pointer(card, 'pointerup', 162, { buttons: 0 });
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(row.scrollLeft).toBe(140);
  } finally { window.removeEventListener('workspace:open-artifact', opened); }
});
it('leaves touch and right-button gestures native and cleans up a cancelled drag', async () => {
  const row = host.querySelector<HTMLUListElement>('ul')!;
  prepareDrag(row);
  await act(async () => {
    pointer(row, 'pointerdown', 200, { pointerType: 'touch' });
    pointer(row, 'pointermove', 100, { pointerType: 'touch' });
    pointer(row, 'pointerdown', 200, { button: 2, buttons: 2 });
    pointer(row, 'pointermove', 100, { buttons: 2 });
  });
  expect(row.scrollLeft).toBe(100);
  expect(row.setPointerCapture).not.toHaveBeenCalled();
  await act(async () => { pointer(row, 'pointerdown', 200); pointer(row, 'pointermove', 180); pointer(row, 'pointercancel', 180); });
  expect(row.dataset.dragging).toBeUndefined();
  expect(row.style.scrollSnapType).toBe('');
  await act(async () => pointer(row, 'pointermove', 100));
  expect(row.scrollLeft).toBe(120);
});
