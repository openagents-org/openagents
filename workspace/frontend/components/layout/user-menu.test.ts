// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { UserMenu } from './user-menu';
import type { WorkspaceMe } from '@/lib/types';
const state = vi.hoisted(() => ({ me: null as WorkspaceMe | null, push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/hooks/use-me', () => ({ useMe: () => state.me }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ workspace: { slug: 'demo' }, token: 'saved-token' }) }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ user: { email: 'sam@example.com' }, isOpenAgentsDomain: true }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('./language-menu', () => ({ LanguageMenuSub: () => null }));
vi.mock('@/components/ui/dropdown-menu', () => {
  const wrap = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  const item = ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => React.createElement('button', { onClick }, children);
  return Object.fromEntries(['DropdownMenu', 'DropdownMenuContent', 'DropdownMenuLabel', 'DropdownMenuPortal', 'DropdownMenuRadioGroup', 'DropdownMenuSeparator', 'DropdownMenuSub', 'DropdownMenuSubContent', 'DropdownMenuSubTrigger', 'DropdownMenuTrigger'].map((key) => [key, wrap]).concat([['DropdownMenuItem', item], ['DropdownMenuRadioItem', wrap]]));
});
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; state.push.mockClear(); });
async function render(role: WorkspaceMe['role']) {
  state.me = role ? { role, effectiveRole: 'owner', authenticated: true, tokenAccess: true } as WorkspaceMe : null;
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(UserMenu)));
}
it.each(['member', 'viewer', null] as const)('hides administrative shortcuts for %s even with a saved token', async (role) => {
  await render(role);
  expect(document.body.textContent).not.toContain('userMenu.workspaceSettings');
  expect(document.body.textContent).not.toContain('userMenu.inviteMembers');
  expect(document.body.textContent).not.toContain('userMenu.copyToken');
  const personal = [...document.querySelectorAll('button')].find((node) => node.textContent === 'userMenu.personalSettings')!;
  await act(async () => personal.click());
  expect(state.push).toHaveBeenCalledWith('/demo/settings/profile');
});
it('retains workspace administration for an admin', async () => {
  await render('admin');
  expect(document.body.textContent).toContain('userMenu.workspaceSettings');
  expect(document.body.textContent).toContain('userMenu.inviteMembers');
  expect(document.body.textContent).toContain('userMenu.copyToken');
});
