// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ controlling: false, input: vi.fn(), revision: 0 }));
vi.mock('./use-browser-control', () => ({ useBrowserControl: () => ({ controlling: state.controlling, busy: false, toggle: vi.fn(), input: state.input, frameRevision: state.revision }) }));
vi.mock('./agent-activity', () => ({ actorName: () => null, useAgentActivity: () => ({ active: false }) }));
vi.mock('./new-browser-tab-dialog', () => ({ NewBrowserTabDialog: () => null }));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => ({ isMobile: false }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useFormatters: () => ({ timeAgoShort: () => '' }) }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  browserTabs: [{ id: 'tab', url: 'https://example.com', title: 'Example', sharedWith: [], createdBy: 'human:user' }],
  browserContexts: [], agents: [], refreshBrowserTabs: vi.fn(),
}) }));
import { BrowserView } from './browser-view';
let host: HTMLDivElement, root: Root, composer: HTMLTextAreaElement;
let shortcut = vi.fn<(event: KeyboardEvent) => void>();
const render = () => act(async () => root.render(React.createElement<{ artifactTabId?: string }>(BrowserView, { artifactTabId: 'tab' })));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.controlling = false; state.input.mockReset(); state.revision = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['frame'], { type: 'image/jpeg' }))));
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:frame'; } static revokeObjectURL() {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  composer = document.createElement('textarea'); document.body.append(composer); composer.focus();
  // Reproduce the formerly unguarded type-to-chat handler, including digit shortcuts.
  shortcut = vi.fn((event: KeyboardEvent) => { if (event.key.length === 1) composer.focus(); });
  window.addEventListener('keydown', shortcut);
});
afterEach(async () => {
  window.removeEventListener('keydown', shortcut);
  await act(async () => root.unmount()); host.remove(); composer.remove(); vi.unstubAllGlobals();
});
it('focuses the preview on takeover and keeps letters, numbers, and Enter out of chat shortcuts', async () => {
  await render();
  expect(document.activeElement).toBe(composer);
  state.controlling = true; await render();
  const img = host.querySelector('textarea')!;
  expect(document.activeElement).toBe(img);
  for (const key of ['h', 'i', '1', 'Enter']) {
    await act(async () => {
      img.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      if (key.length === 1) { img.value = key; img.dispatchEvent(new InputEvent('input', { bubbles: true, data: key })); }
    });
    expect(document.activeElement).toBe(img);
  }
  expect(shortcut).not.toHaveBeenCalled();
  expect(state.input.mock.calls.map(([value]) => value)).toEqual([
    { kind: 'text', text: 'h' }, { kind: 'text', text: 'i' }, { kind: 'text', text: '1' }, { kind: 'key', key: 'Enter' },
  ]);
});
it('does not steal focus back during a frame refresh and releases keyboard focus on hand-back', async () => {
  state.controlling = true; await render();
  const img = host.querySelector('textarea')!;
  composer.focus(); state.revision++; await render();
  expect(document.activeElement).toBe(composer);
  img.focus(); state.controlling = false; await render();
  expect(document.activeElement).not.toBe(img);
  expect(img.tabIndex).toBe(-1);
});
it('keeps paste and Escape local to the preview', async () => {
  state.controlling = true; await render();
  const img = host.querySelector('textarea')!;
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '你好' } });
  await act(async () => img.dispatchEvent(paste));
  expect(state.input).toHaveBeenCalledWith({ kind: 'text', text: '你好' });
  await act(async () => img.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.activeElement).not.toBe(img);
  expect(shortcut).not.toHaveBeenCalled();
});

it('sends committed Chinese composition once without forwarding intermediate keys', async () => {
  state.controlling = true; await render();
  const input = host.querySelector('textarea')!;
  await act(async () => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = 'ni'; input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    input.value = '你好'; input.dispatchEvent(new CompositionEvent('compositionend', { data: '你好', bubbles: true }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  expect(state.input.mock.calls.map(([value]) => value)).toEqual([{ kind: 'text', text: '你好' }]);
});
