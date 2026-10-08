// @vitest-environment jsdom
import React, { Activity, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppHeaderActions } from './app-header';

vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({}) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('./layout-context', () => ({ useLayout: () => ({ isMobile: false }) }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// Mirrors the desktop shell: a shared header toolbar, plus views kept mounted
// behind <Activity> that portal their actions into it.
function Shell({ view }: { view: 'tasks' | 'workflows' }) {
  const e = React.createElement;
  return e(React.Fragment, null,
    e('div', { id: 'app-header-actions' }),
    e(Activity, { mode: view === 'tasks' ? 'visible' : 'hidden' },
      e(AppHeaderActions, null, e('button', null, 'New task'))),
    e(Activity, { mode: view === 'workflows' ? 'visible' : 'hidden' },
      e(AppHeaderActions, null, e('button', null, 'New workflow'))),
  );
}

const toolbarText = () => document.getElementById('app-header-actions')!.textContent;

it('shows only the visible view\'s actions in the shared header', async () => {
  await act(async () => { root.render(React.createElement(Shell, { view: 'tasks' })); });
  expect(toolbarText()).toBe('New task');

  await act(async () => { root.render(React.createElement(Shell, { view: 'workflows' })); });
  expect(toolbarText()).toBe('New workflow');

  await act(async () => { root.render(React.createElement(Shell, { view: 'tasks' })); });
  expect(toolbarText()).toBe('New task');
});
