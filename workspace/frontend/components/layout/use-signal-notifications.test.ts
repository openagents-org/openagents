// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ play: vi.fn(), state: { sessions: [] as any[], signals: [] as any[], notifications: [] as any[], signalsLoaded: false, notificationsLoaded: false, notificationSound: true, signalSound: true, currentSessionId: 'thread', setCurrentSessionId: vi.fn() }, layout: { viewMode: 'files', openView: vi.fn(), isMobile: false, openMobileDetail: vi.fn() } }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => mocks.state }));
vi.mock('./layout-context', () => ({ useLayout: () => mocks.layout }));
vi.mock('@/lib/notification-audio', () => ({ armNotificationAudio: () => () => {}, playNotificationSound: mocks.play }));
import { useSignalNotifications } from './use-signal-notifications';
function Harness() { useSignalNotifications(); return null; }
it('alerts for new messages while viewing Files, baselines old inbox rows and respects sound switches', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const host = document.createElement('div'); const root = createRoot(host);
  const render = () => act(async () => root.render(React.createElement(Harness)));
  const item = (id: string) => ({ id, createdAt: id, channelName: 'thread', isRead: false });
  try {
    await render();
    mocks.state.signalsLoaded = mocks.state.notificationsLoaded = true;
    mocks.state.notifications = [item('old')];
    await render(); expect(mocks.play).not.toHaveBeenCalled();
    mocks.state.signals = [item('new-message')];
    await render(); expect(mocks.play).toHaveBeenCalledTimes(1);
    mocks.state.notifications = [...mocks.state.notifications, item('new-inbox')];
    await render(); expect(mocks.play).toHaveBeenCalledTimes(2);
    mocks.state.sessions = [{ sessionId: 'thread', completionAt: 1 }];
    await render(); expect(mocks.play).toHaveBeenCalledTimes(2);
    mocks.state.sessions = [{ sessionId: 'thread', completionAt: 2 }];
    await render(); expect(mocks.play).toHaveBeenCalledTimes(3);
    mocks.layout.viewMode = 'threads';
    mocks.state.signals = [...mocks.state.signals, item('visible-message')];
    await render(); expect(mocks.play).toHaveBeenCalledTimes(3);
    mocks.state.notificationSound = false;
    mocks.state.notifications = [...mocks.state.notifications, item('muted')];
    await render(); expect(mocks.play).toHaveBeenCalledTimes(3);
  } finally { await act(async () => root.unmount()); }
});
