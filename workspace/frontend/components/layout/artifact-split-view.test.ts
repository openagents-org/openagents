// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtifactSplitView } from './artifact-split-view';

vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1000, width: 1000 } as DOMRect);
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  function Harness() {
    const [width, setWidth] = React.useState(40);
    return React.createElement(ArtifactSplitView, {
    width, onResize: value => { setWidth(value); localStorage.setItem('split', String(value)); },
    conversation: React.createElement('div', null, 'Chat'),
    preview: React.createElement('iframe', { title: 'Web preview' }),
    });
  }
  await act(async () => root.render(React.createElement(Harness)));
  return host.querySelector<HTMLElement>('[role="separator"]')!;
}
it('supports controlled width, keyboard resizing, clamps, and reset', async () => {

  const divider = await render();
  expect(divider.getAttribute('aria-valuenow')).toBe('40');
  await act(async () => divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  expect(localStorage.getItem('split')).toBe('38');
  await act(async () => divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
  expect(divider.getAttribute('aria-valuenow')).toBe('72');
  await act(async () => divider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(divider.getAttribute('aria-valuenow')).toBe('50');
  expect(host.querySelector('iframe')).not.toBeNull();
});
it('resizes while dragging over the preview and removes the drag shield on release', async () => {
  const divider = await render();
  divider.setPointerCapture = vi.fn();
  divider.hasPointerCapture = vi.fn(() => true);
  divider.releasePointerCapture = vi.fn();
  await act(async () => divider.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true })));
  expect(host.querySelector('.select-none')).not.toBeNull();
  await act(async () => divider.dispatchEvent(new MouseEvent('pointermove', { clientX: 350, bubbles: true })));
  expect(divider.getAttribute('aria-valuenow')).toBe('35');
  await act(async () => divider.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
  expect(host.querySelector('.select-none')).toBeNull();
  expect(localStorage.getItem('split')).toBe('35');
});
