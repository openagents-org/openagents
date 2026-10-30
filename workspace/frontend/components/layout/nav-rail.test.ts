// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NavRail } from './nav-rail';

const state = vi.hoisted(() => ({ openView: vi.fn(), unreadThreadsTotal: 0 }));
vi.mock('./layout-context', () => ({ useLayout: () => ({
  viewMode: 'threads', openView: state.openView, isRailExpanded: true, railDragWidth: null,
}), RAIL_WIDTH_COLLAPSED: 48, RAIL_WIDTH_EXPANDED: 180 }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  unreadThreadsTotal: state.unreadThreadsTotal, workspace: { name: 'Test' }, agents: [{ agentName: 'shared', ownerEmail: 'maya@example.com', status: 'online', canStartThread: true }],
  currentUser: { id: 'sam@example.com' }, tasks: [], onlineUsers: [], pendingApprovalsByAgent: {}, unreadDmCounts: {},
}) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/ui/sidebar', () => {
  const wrap = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  return Object.fromEntries(['Sidebar', 'SidebarContent', 'SidebarFooter', 'SidebarGroup', 'SidebarGroupContent', 'SidebarGroupLabel', 'SidebarHeader', 'SidebarMenu', 'SidebarMenuItem'].map(k => [k, wrap]).concat([
    ['SidebarMenuButton', ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => React.createElement('button', { onClick }, children)],
  ]));
});
vi.mock('@/components/ui/tooltip', () => {
  const wrap = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  return { Tooltip: wrap, TooltipContent: wrap, TooltipTrigger: wrap };
});
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('./sidebar-members', () => ({ SidebarMembers: () => null }));
vi.mock('./search-menu', () => ({ SearchMenu: () => null }));
vi.mock('./notifications-menu', () => ({ NotificationsMenu: () => null }));
vi.mock('./invite-member-button', () => ({ InviteMemberButton: () => null }));
vi.mock('./user-menu', () => ({ UserMenu: () => null }));
vi.mock('@/components/campaign/campaign-sidebar-card', () => ({ CampaignSidebarCard: () => null }));
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('shows shared agents alongside workspace navigation for a member with no owned agents', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(NavRail)));
    for (const label of ['views.files', 'views.knowledge', 'views.issues', 'views.inbox', 'collab.viewAgents']) expect(host.textContent).toContain(label);
    expect(host.textContent).toContain('shared');
    expect(host.textContent).toContain('nav.agentsWithCount');
    expect(host.textContent).not.toContain('views.tasks');
    const services = [...host.querySelectorAll('button')].find(b => b.textContent === 'collab.viewAgents')!;
    await act(async () => services.click());
    expect(state.openView).toHaveBeenCalledWith('agents');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('shows the Threads unread total, caps large counts, and clears the badge at zero', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const threads = () => [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('views.threads'))!;
  try {
    state.unreadThreadsTotal = 7;
    await act(async () => root.render(React.createElement(NavRail)));
    expect(threads().querySelector('[aria-label="nav.unreadCount"]')?.textContent).toBe('7');
    state.unreadThreadsTotal = 120;
    await act(async () => root.render(React.createElement(NavRail)));
    expect(threads().querySelector('[aria-label="nav.unreadCount"]')?.textContent).toBe('99+');
    state.unreadThreadsTotal = 0;
    await act(async () => root.render(React.createElement(NavRail)));
    expect(threads().querySelector('[aria-label="nav.unreadCount"]')).toBeNull();
  } finally { state.unreadThreadsTotal = 0; await act(async () => root.unmount()); host.remove(); }
});
