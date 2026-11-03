// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import MembersSettingsPage from './page';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/settings/admin-context', () => ({ useAdminSettings: () => ({ me: { role: 'owner' } }), canAdminister: () => true }));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/settings/agent-roster', () => ({ AgentRoster: () => null }));
vi.mock('@/components/settings/groups-panel', () => ({ GroupsPanel: () => null }));
vi.mock('@/lib/api', () => ({ workspaceApi: { getTeam: vi.fn(), listInvites: vi.fn(), createInvite: vi.fn() } }));
let root: Root;
let host: HTMLDivElement;
const invite = { inviteId: 'synthetic', status: 'pending', role: 'member', url: 'https://example.invalid/invite/synthetic' };
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(workspaceApi.getTeam).mockResolvedValue([]);
  vi.mocked(workspaceApi.listInvites).mockResolvedValue([invite] as never);
  vi.mocked(workspaceApi.createInvite).mockResolvedValue(invite as never);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) } });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(MembersSettingsPage)));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function click(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find(node => node.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
it('reports denied copying of an existing link when fallback is unsupported', async () => {
  await click('admin.copyLink');
  expect(toast.error).toHaveBeenCalledWith('chat.copyFailed');
  expect(toast.success).not.toHaveBeenCalled();
});
it('preserves creation success when the separate copy step fails', async () => {
  await click('admin.createInviteLink');
  expect(workspaceApi.createInvite).toHaveBeenCalledTimes(1);
  expect(toast.success).toHaveBeenCalledWith('admin.linkCreated');
  expect(toast.success).not.toHaveBeenCalledWith('admin.linkCopied');
  expect(toast.error).not.toHaveBeenCalled();
});
