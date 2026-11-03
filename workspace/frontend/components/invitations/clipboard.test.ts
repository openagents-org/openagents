// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InvitationDialog } from './invitation-dialog';
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useFormatters: () => ({ timeAgo: () => 'now' }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/api', () => ({ workspaceApi: { listInvitations: async () => [
  { invitationId: 'a', status: 'pending', targetAgentName: 'a', inviteToken: 'synthetic-a' },
  { invitationId: 'b', status: 'pending', targetAgentName: 'b', inviteToken: 'synthetic-b' },
] } }));
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(InvitationDialog)));
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="invitations.inviteAgent"]')!.click());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function buttons() { const b = [...document.querySelectorAll<HTMLButtonElement>('button[title="invitations.copyToken"]')]; expect(b).toHaveLength(2); return b; }
it('does not let the first row timeout clear the later successful row', async () => {
  await act(async () => buttons()[0].click());
  await act(async () => vi.advanceTimersByTime(1000));
  await act(async () => buttons()[1].click());
  await act(async () => vi.advanceTimersByTime(1000));
  expect(buttons()[1].querySelector('.lucide-check')).not.toBeNull();
  expect(buttons()[0].querySelector('.lucide-check')).toBeNull();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(buttons()[1].querySelector('.lucide-check')).toBeNull();
});
it('does not acknowledge the old row after a newer failed attempt', async () => {
  let finish!: () => void;
  vi.mocked(navigator.clipboard.writeText).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => buttons()[0].click());
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
  await act(async () => buttons()[1].click());
  await act(async () => finish());
  expect(buttons().every(b => !b.querySelector('.lucide-check'))).toBe(true);
});
