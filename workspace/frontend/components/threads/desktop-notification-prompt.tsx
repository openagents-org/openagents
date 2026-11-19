'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';
import { NOTIFICATION_PROMPT_DISMISSED_KEY, shouldShowNotificationPrompt } from '@/lib/signals';

function currentPermission(): string | null {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  return Notification.permission;
}

/** Permission is requested only after the user clicks Enable in the sidebar callout. */
export function useDesktopNotificationPrompt() {
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

  return { show, dismiss, enable };
}

/** Inline sidebar footer card; never overlays the conversation or thread list. */
export function DesktopNotificationPrompt({ hidden = false }: { hidden?: boolean }) {
  const t = useT();
  const prompt = useDesktopNotificationPrompt();
  if (hidden || !prompt.show) return null;

  return (
    <div className="mb-2 w-full min-w-0 rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-3">
      <div className="flex items-start gap-1">
        <p className="min-w-0 flex-1 text-xs leading-5 text-sidebar-foreground">{t('slackSignals.promptText')}</p>
        <Button
          variant="ghost"
          size="icon-xs"
          className="-mt-1 -mr-1 shrink-0 text-muted-foreground"
          aria-label={t('slackSignals.promptDismiss')}
          onClick={prompt.dismiss}
        >
          <X />
        </Button>
      </div>
      <Button size="xs" className="mt-2" onClick={prompt.enable}>
        {t('slackSignals.promptEnable')}
      </Button>
    </div>
  );
}
