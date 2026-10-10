'use client';

import { useEffect, useRef } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { diffNewSignals, shouldNotify } from '@/lib/signals';
import { useLayout } from './layout-context';

const NOTIFICATION_ICON = '/android-chrome-192x192.png';

function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Slack-style alerts for DMs and @mentions: on a signal that's new in this
 * browser session (not the ones already there on load), raise a desktop
 * notification and play the sound — unless the user is looking right at that
 * conversation. Clicking the notification focuses the window and opens it.
 *
 * Uses the plain web Notification API, so it behaves the same inside the
 * Electron Launcher. Never asks for permission itself (see
 * DesktopNotificationPrompt).
 */
export function useSignalNotifications() {
  const { signals, signalsLoaded, signalSound, currentSessionId, setCurrentSessionId } = useWorkspace();
  const { openView, isMobile, openMobileDetail } = useLayout();

  const seenRef = useRef<Set<string> | null>(null);
  // Read through refs so a notification clicked minutes later opens the
  // conversation with the current handlers, not the ones from when it fired.
  const openRef = useRef<(channel: string) => void>(() => {});
  openRef.current = (channel: string) => {
    openView('threads');
    setCurrentSessionId(channel);
    if (isMobile) openMobileDetail();
  };
  const ctxRef = useRef({ currentSessionId, signalSound });
  ctxRef.current = { currentSessionId, signalSound };

  // A workspace switch resets signals to "not loaded": start a fresh baseline.
  useEffect(() => {
    if (!signalsLoaded) seenRef.current = null;
  }, [signalsLoaded]);

  useEffect(() => {
    if (!signalsLoaded) return;
    const { fresh, seen } = diffNewSignals(seenRef.current, signals);
    seenRef.current = seen;
    if (fresh.length === 0 || typeof document === 'undefined') return;

    const notifyCtx = {
      hidden: document.visibilityState === 'hidden',
      focused: document.hasFocus(),
      openSessionId: ctxRef.current.currentSessionId,
    };
    const toAlert = fresh.filter((n) => shouldNotify(n, notifyCtx));
    if (toAlert.length === 0) return;

    if (ctxRef.current.signalSound) {
      try {
        const audio = new Audio('/notification.wav');
        audio.volume = 0.35;
        audio.play().catch(() => {});
      } catch { /* no audio */ }
    }

    if (!notificationsSupported() || Notification.permission !== 'granted') return;
    for (const signal of toAlert) {
      const channel = signal.channelName;
      try {
        const n = new Notification(signal.title || 'OpenAgents', {
          body: signal.message || '',
          // One live notification per conversation: a repeat replaces it.
          tag: channel || signal.id,
          icon: NOTIFICATION_ICON,
        });
        n.onclick = () => {
          try { window.focus(); } catch { /* ignore */ }
          if (channel) openRef.current(channel);
          n.close();
        };
      } catch {
        // Some platforms (e.g. Android Chrome) only allow notifications from a
        // service worker; the phone push covers them.
      }
    }
  }, [signals, signalsLoaded]);
}
