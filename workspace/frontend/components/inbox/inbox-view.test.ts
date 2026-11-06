// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { NotificationCard } from './inbox-view';
import type { NotificationItem } from '@/lib/types';

vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ agents: [], sessions: [] }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useFormatters: () => ({ timeAgoShort: () => '1m' }) }));
vi.mock('@/hooks/use-team-roster', () => ({ useHumanNames: () => ({}) }));
vi.mock('@/hooks/use-me', () => ({ useMe: () => null }));
vi.mock('@/components/agents/agent-avatar', () => ({ AgentAvatar: () => null }));
vi.mock('@/components/chat/approval-card', () => ({ ApprovalCard: () => null }));
vi.mock('@/components/layout/app-header', () => ({ DetailHeader: () => null }));
vi.mock('@/lib/api', () => ({ workspaceApi: {} }));
vi.mock('./use-open-notification', () => ({ useOpenNotification: () => vi.fn() }));
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let root: Root;
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });

function row(over: Partial<NotificationItem>): NotificationItem {
  return {
    id: 'n1', title: 'Weekly report', message: 'Stars up', priority: 'normal', isRead: false,
    createdBy: 'openagents:cherie-bot', channelName: null, threadId: null, linkUrl: null,
    status: 'active', kind: null, actionRef: null, recipientEmail: null,
    createdAt: '2026-11-06T00:00:00Z', readAt: null, ...over,
  };
}

async function dotFor(over: Partial<NotificationItem>) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(NotificationCard, {
    notification: row(over), onRead: vi.fn(), onDismiss: vi.fn(), onNavigate: vi.fn(),
  })));
  return document.querySelector('[data-testid="inbox-unread-dot"]')!.className;
}

it('shows a red dot for an unread high-priority notification', async () => {
  const cls = await dotFor({ priority: 'high', isRead: false });
  expect(cls).toContain('bg-red-500');
  expect(cls).not.toContain('invisible');
});

it.each(['normal', 'low'] as const)('shows a blue dot for an unread %s notification', async (priority) => {
  const cls = await dotFor({ priority, isRead: false });
  expect(cls).toContain('bg-blue-500');
  expect(cls).not.toContain('invisible');
});

it.each(['high', 'normal', 'low'] as const)('hides the dot once a %s notification is read', async (priority) => {
  const cls = await dotFor({ priority, isRead: true });
  expect(cls).toContain('invisible');
  expect(cls).not.toMatch(/bg-(red|blue)-500/);
});
