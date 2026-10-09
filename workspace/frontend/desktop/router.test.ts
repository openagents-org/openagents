// @vitest-environment jsdom
import React, { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopRouter, usePathname, type RouteTable } from './router';

vi.mock('@/lib/workspace-session', () => ({ loadWorkspaceSession: () => null }));

let root: Root;
let container: HTMLDivElement;
const mounts: string[] = [];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mounts.length = 0;
  window.location.hash = '#/acme';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const e = React.createElement;

/** Counts its own mounts and shows the pathname it sees. */
function View({ name }: { name: string }) {
  const [instance] = useState(() => mounts.push(name));
  const pathname = usePathname();
  useEffect(() => {}, []);
  return e('p', { 'data-view': name }, `${name}#${instance}:${pathname}`);
}

const workspaceKey = (p: Record<string, string>) => `workspace/${p.workspaceId}`;
const ROUTES: RouteTable = [
  {
    pattern: '/:workspaceId/settings/:section',
    mountKey: (p) => `settings/${p.workspaceId}`,
    parentKey: workspaceKey,
    render: () => e(View, { name: 'settings' }),
  },
  { pattern: '/:workspaceId', mountKey: workspaceKey, render: () => e(View, { name: 'workspace' }) },
];

async function go(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

const view = (name: string) => container.querySelector(`[data-view="${name}"]`) as HTMLElement | null;

it('keeps the workspace mounted behind its settings and shares one settings mount', async () => {
  await act(async () => root.render(e(DesktopRouter, { routes: ROUTES, notFound: null })));
  expect(view('workspace')!.textContent).toBe('workspace#1:/acme');

  await go('#/acme/settings/general');
  await go('#/acme/settings/members');
  // Hidden, not unmounted, and still reading its own route.
  expect(view('workspace')!.style.display).toBe('none');
  expect(view('workspace')!.textContent).toBe('workspace#1:/acme');
  expect(view('settings')!.textContent).toBe('settings#2:/acme/settings/members');

  await go('#/acme');
  expect(view('settings')).toBeNull();
  expect(view('workspace')!.style.display).toBe('');
  expect(mounts).toEqual(['workspace', 'settings']);
});

it('drops the kept workspace when another workspace opens', async () => {
  await act(async () => root.render(e(DesktopRouter, { routes: ROUTES, notFound: null })));
  await go('#/beta/settings/general');
  expect(view('workspace')).toBeNull();
  await go('#/beta');
  expect(mounts).toEqual(['workspace', 'settings', 'workspace']);
});
