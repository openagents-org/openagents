// @vitest-environment jsdom
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn() }), push: vi.fn(), prompt: vi.fn(), rename: vi.fn(),
  workspace: { workspaceId: 'w1', slug: 'mine', name: "Mia's workspace" },
}));
vi.mock('sonner', () => ({ toast: state.toast }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/components/ui/dialogs-provider', () => ({ usePrompt: () => state.prompt }));
vi.mock('@/lib/desktop-host', () => ({ desktopHost: () => null }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ workspace: state.workspace, loading: false, renameWorkspace: state.rename }) }));
import { useLandingNote } from './use-landing-note';

function Probe() { useLandingNote(); return null; }
let root: Root;
const note = (reason: string) => sessionStorage.setItem('oa_landing_note', JSON.stringify({ slug: 'mine', workspaceId: 'w1', name: 'x', reason }));
const mount = async () => { await act(async () => root.render(createElement(Probe))); };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.toast.mockReset(); state.toast.success.mockReset(); state.push.mockReset(); state.prompt.mockReset(); state.rename.mockReset();
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); sessionStorage.clear(); localStorage.clear(); });

it('says a new workspace was created for the user, and renames it from the note', async () => {
  note('created');
  await mount();
  const [title, opts] = state.toast.mock.calls[0];
  expect(title).toBe('workspaceLanding.createdTitle');
  opts.cancel.onClick();
  expect(state.push).toHaveBeenCalledWith('/');
  state.prompt.mockResolvedValue(' Design team ');
  await act(async () => { await opts.action.onClick(); });
  expect(state.rename).toHaveBeenCalledWith('Design team');
  expect(sessionStorage.getItem('oa_landing_note')).toBeNull();
});

it('explains an invited workspace, and stops repeating "your only workspace" after a few sessions', async () => {
  note('invited');
  await mount();
  expect(state.toast.mock.calls[0][0]).toBe('workspaceLanding.invitedTitle');
  for (let i = 0; i < 4; i++) {
    await act(async () => root.unmount());
    root = createRoot(document.createElement('div'));
    note('only');
    await mount();
  }
  expect(state.toast.mock.calls.filter(([title]) => title === 'workspaceLanding.onlyTitle')).toHaveLength(3);
});

it('says nothing when the workspace was opened on purpose', async () => {
  await mount();
  expect(state.toast).not.toHaveBeenCalled();
});
