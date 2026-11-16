// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RailEdge } from './rail-edge';

const state = vi.hoisted(() => ({ toggleRail: vi.fn() }));
vi.mock('./layout-context', () => ({
  useLayout: () => ({ isRailExpanded: true, toggleRail: state.toggleRail }),
}));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/ui/sidebar', () => ({
  SidebarRail: (props: React.ComponentProps<'button'>) => React.createElement('button', props),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

afterEach(() => {
  state.toggleRail.mockReset();
  document.body.innerHTML = '';
});

async function render() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(RailEdge)));
  return { host, root };
}

it('toggles the rail when its edge is clicked', async () => {
  const { host, root } = await render();
  const edge = host.querySelector('button')!;
  expect(edge.getAttribute('aria-label')).toBe('nav.collapseSidebar');
  await act(async () => edge.click());
  expect(state.toggleRail).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

it('takes Cmd/Ctrl+B for the rail before the list panel shortcut sees it', async () => {
  const listToggle = vi.fn();
  window.addEventListener('keydown', listToggle);
  const { root } = await render();
  try {
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    });
    expect(state.toggleRail).toHaveBeenCalledTimes(2);
    // Only the plain "b" reaches the bubble-phase listener.
    expect(listToggle).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener('keydown', listToggle);
    await act(async () => root.unmount());
  }
});
