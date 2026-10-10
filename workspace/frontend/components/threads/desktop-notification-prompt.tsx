'use client';

import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';
import { NOTIFICATION_PROMPT_DISMISSED_KEY, shouldShowNotificationPrompt } from '@/lib/signals';

function currentPermission(): string | null {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  return Notification.permission;
}

/**
 * One-line ask for desktop-notification permission, shown at the top of the
 * thread list the first time the user has a DM / mention signal or opens a DM.
 * Permission is only ever requested from the Enable click — never on load.
 */
export function DesktopNotificationPrompt() {
  const t = useT();
  const { signals, currentSessionId } = useWorkspace();
  const [permission, setPermission] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
    setPermission(currentPermission());
    try {
      setDismissed(localStorage.getItem(NOTIFICATION_PROMPT_DISMISSED_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  // Sticky: once there's a reason to ask, keep asking until answered/dismissed.
  useEffect(() => {
    if (signals.length > 0 || currentSessionId?.startsWith('dm:')) setTriggered(true);
  }, [signals.length, currentSessionId]);

  const show = shouldShowNotificationPrompt({
    supported: permission !== null,
    permission,
    dismissed,
    triggered,
  });
  if (!show) return null;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(NOTIFICATION_PROMPT_DISMISSED_KEY, '1'); } catch {}
  };

  const enable = async () => {
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
    } catch {
      setPermission(currentPermission());
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-xs">
      <BellRing className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-foreground/80">{t('slackSignals.promptText')}</span>
      <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-xs" onClick={enable}>
        {t('slackSignals.promptEnable')}
      </Button>
      <Button
        variant="ghost"
        mode="icon"
        size="sm"
        className="size-6 shrink-0 text-muted-foreground"
        aria-label={t('slackSignals.promptDismiss')}
        onClick={dismiss}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
