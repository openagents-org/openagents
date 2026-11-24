'use client';

import { useEffect, useState } from 'react';
import { BookmarkPlus, Check, ChevronRight, Copy, ExternalLink, Eye, LogIn, ShieldAlert, X } from 'lucide-react';
import { STRIP } from '@/components/chat/chat-view-banners';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';
import type { GuestLink } from '@/lib/guest-links';
import { useFormatters, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { GuestLinkSection } from './guest-link-dialog';

/**
 * The guest page as guests see it, for the owner's preview: same path on this
 * app (so it renders this build), with `?preview=1` (read only, no posting).
 */
export function guestPreviewUrl(linkUrl: string, origin = typeof window !== 'undefined' ? window.location.origin : ''): string {
  let path = linkUrl;
  try { path = new URL(linkUrl).pathname; } catch { /* already a path */ }
  return `${origin}${path}?preview=1`;
}

/**
 * The owner's panel, always in view at the top of the owner room's sidebar:
 * this is the owner page (don't share it), copy the guest link, preview it,
 * and how guests may use the agent — each line opens that setting.
 */
export function OwnerPanel({ link, guestCount, onOpenSettings, onPreview, saveCard }: {
  /** The live guest link, or null when it's off. */
  link: GuestLink | null;
  guestCount: number | null;
  onOpenSettings: (section: GuestLinkSection | null) => void;
  onPreview: () => void;
  /** The "not saved yet" / "saved" card under the panel. */
  saveCard?: React.ReactNode;
}) {
  const t = useT();
  const { formatDateTime } = useFormatters();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 6000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch { /* clipboard blocked: the link settings show the URL to copy by hand */ }
  };

  const mode = link?.approvalMode ?? 'none';
  const rows: { section: GuestLinkSection; label: string; value: string; tone?: 'muted' | 'warning' }[] = [
    { section: 'requests', label: t('shareRoom.policyRequests'), value: mode === 'owner' ? t('shareRoom.policyRequestsOwner') : mode === 'off' ? t('shareRoom.policyRequestsOff') : t('shareRoom.policyRequestsNone') },
    { section: 'post', label: t('shareRoom.policyPost'), value: !link || link.canPost ? t('shareRoom.policyPostYes') : t('shareRoom.policyPostNo') },
    { section: 'expiry', label: t('shareRoom.policyLink'), value: !link ? t('shareRoom.policyLinkOff') : link.expiresAt ? t('shareRoom.policyLinkExpires', { date: formatDateTime(link.expiresAt) }) : t('shareRoom.policyLinkNever'), tone: !link ? 'warning' : undefined },
    { section: 'guests', label: t('shareRoom.policyGuests'), value: guestCount === null ? '…' : String(guestCount) },
  ];

  return (
    <div className="flex flex-col gap-2" data-owner-panel="">
      <div className="rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-warning">
        <p className="flex items-start gap-1.5 text-xs font-medium leading-snug"><ShieldAlert className="mt-px size-3.5 shrink-0" />{t('shareRoom.ownerPage')}</p>
        <p className="mt-1 pl-5 text-[11px] leading-snug text-warning/80">{t('shareRoom.ownerPageHelp')}</p>
      </div>
      {link ? (
        <div className="flex flex-col gap-1">
          <Button size="sm" onClick={() => void copy()} className="w-full" data-owner-copy-link="">
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copied ? t('shareRoom.guestLinkCopied') : t('shareRoom.copyGuestLink')}
          </Button>
          {copied ? (
            <Button size="xs" variant="link" className="h-auto self-center py-0.5 text-xs" onClick={onPreview} data-owner-see-guests="">
              <Eye data-icon="inline-start" />{t('shareRoom.seeWhatGuestsSee')}
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="w-full bg-background" onClick={onPreview} data-owner-preview="">
              <Eye data-icon="inline-start" />{t('shareRoom.previewAsGuest')}
            </Button>
          )}
        </div>
      ) : (
        <button type="button" className="rounded-md border border-dashed px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-sidebar-accent" onClick={() => onOpenSettings(null)} data-owner-no-link="">
          {t('shareRoom.noLink')}
        </button>
      )}
      <ul className="flex flex-col rounded-lg border bg-background/60 py-1" data-owner-policy="">
        {rows.map((row) => (
          <li key={row.section}>
            <button type="button" onClick={() => onOpenSettings(row.section)} aria-label={t('shareRoom.policyChange', { setting: row.label })}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:outline-none" data-owner-policy-row={row.section}>
              <span className="shrink-0 text-muted-foreground">{row.label}</span>
              <span className={cn('min-w-0 flex-1 truncate text-right font-medium', row.tone === 'warning' && 'text-warning')} title={row.value} data-owner-policy-value="">{row.value}</span>
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      {saveCard}
    </div>
  );
}

/**
 * Under the owner panel: the room isn't in an account yet (lose the link,
 * lose the room) with a way to save it — or a quiet "saved" line.
 */
export function SaveCard({ saved, signedIn, onSave }: { saved: boolean; signedIn: boolean; onSave: () => void }) {
  const t = useT();
  if (saved) {
    return (
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground" data-owner-saved="">
        <Check className="size-3.5 text-success" />{t('shareRoom.savedLine')} ·{' '}
        <a href="/rooms" className="font-medium text-foreground underline-offset-2 hover:underline">{t('rooms.myRooms')}</a>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background/60 p-2.5" data-owner-not-saved="">
      <div>
        <p className="text-xs font-medium">{t('shareRoom.notSaved')}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t('shareRoom.notSavedBody')}</p>
      </div>
      <Button size="sm" variant="outline" className="w-full" onClick={onSave} data-owner-save="">
        {signedIn ? <BookmarkPlus data-icon="inline-start" /> : <LogIn data-icon="inline-start" />}
        {signedIn ? t('shareRoom.saveToRoomsShort') : t('shareRoom.signInToSave')}
      </Button>
    </div>
  );
}

/** Remembered per room in this browser: a dismissed banner stays dismissed. */
export function useDismissed(key: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(() => {
    try { return typeof window !== 'undefined' && window.localStorage.getItem(key) === '1'; } catch { return false; }
  });
  const dismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(key, '1'); } catch { /* memory only */ }
  };
  return [dismissed, dismiss];
}

/** A dismissible strip at the top of the conversation. */
export function DismissibleStrip({ icon, children, action, onDismiss, tone = 'muted', className, ...rest }: {
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  onDismiss: () => void;
  tone?: 'muted' | 'warning';
  className?: string;
} & Record<`data-${string}`, string>) {
  const t = useT();
  return (
    <Alert role="status" className={cn(STRIP, tone === 'warning' ? 'border-warning/30 bg-warning/10 text-warning' : 'bg-muted/40', className)} {...rest}>
      {icon}
      <AlertDescription className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 pr-6 text-xs', tone === 'warning' ? 'text-warning' : 'text-foreground/80')}>
        <span className="min-w-0">{children}</span>
        {action}
      </AlertDescription>
      <AlertAction>
        <Button variant="ghost" size="icon-xs" onClick={onDismiss} aria-label={t('shareRoom.dismiss')} data-strip-dismiss=""><X /></Button>
      </AlertAction>
    </Alert>
  );
}

/** A live, scaled-down guest page (read-only preview) with "Open in new tab". */
export function GuestPreviewDialog({ open, onOpenChange, url }: { open: boolean; onOpenChange: (open: boolean) => void; url: string | null }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl" data-guest-preview-dialog="">
        <DialogHeader>
          <DialogTitle>{t('shareRoom.previewTitle')}</DialogTitle>
          <DialogDescription>{t('shareRoom.previewBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {url && (
            <div className="relative h-[60vh] w-full overflow-hidden rounded-lg border bg-muted sm:h-[540px]">
              {/* Rendered at desktop size and scaled down on wide screens; full size on phones. */}
              <iframe
                src={url}
                title={t('shareRoom.previewTitle')}
                sandbox="allow-scripts allow-same-origin"
                className="absolute top-0 left-0 h-full w-full border-0 bg-background sm:h-[166.67%] sm:w-[166.67%] sm:origin-top-left sm:scale-[0.6]"
                data-guest-preview-frame=""
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
          {url && <Button asChild><a href={url} target="_blank" rel="noopener noreferrer" data-guest-preview-open=""><ExternalLink data-icon="inline-start" />{t('shareRoom.openInNewTab')}</a></Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

