'use client';

import { useEffect, useState } from 'react';
import { BookmarkPlus, Bot, Check, ChevronRight, Clock, Copy, ExternalLink, Eye, Globe, Lock, LogIn, MessageSquare, Plus, ShieldAlert, Users, X } from 'lucide-react';
import { WithTooltip } from '@/components/ui/with-tooltip';
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
 * The owner's "Sharing" block at the bottom of the owner page's sidebar,
 * like a condensed Google Docs share dialog: who can open it, how guests may
 * use the agent, the link's lifetime and guests — each line opens that
 * setting — plus Copy guest link and Preview, and a small "owner page" note.
 */
export function OwnerPanel({ link, guestCount, onOpenSettings, onPreview, saveCard }: {
  /** The live guest link, or null when it's off. */
  link: GuestLink | null;
  guestCount: number | null;
  onOpenSettings: (section: GuestLinkSection | null) => void;
  onPreview: () => void;
  /** The "not saved yet" / "saved" line under the block. */
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
  const invited = link?.access === 'invited';
  const rows: { section: GuestLinkSection; icon: React.ReactNode; label: string; value: string; tone?: 'warning' }[] = [
    { section: 'access', icon: invited ? <Lock /> : <Globe />, label: t('shareJam.policyAccess'), value: invited ? t('shareJam.policyAccessInvited') : t('shareJam.policyAccessLink') },
    { section: 'requests', icon: <Bot />, label: t('shareJam.policyRequests'), value: mode === 'owner' ? t('shareJam.policyRequestsOwner') : mode === 'off' ? t('shareJam.policyRequestsOff') : t('shareJam.policyRequestsNone') },
    { section: 'post', icon: <MessageSquare />, label: t('shareJam.policyPost'), value: !link || link.canPost ? t('shareJam.policyPostYes') : t('shareJam.policyPostNo') },
    { section: 'agents', icon: <Plus />, label: t('jamAgents.policyGuestAgents'), value: link?.allowGuestAgents && link.canPost ? t('jamAgents.policyGuestAgentsOn') : t('jamAgents.policyGuestAgentsOff') },
    { section: 'expiry', icon: <Clock />, label: t('shareJam.policyLink'), value: !link ? t('shareJam.policyLinkOff') : link.expiresAt ? t('shareJam.policyLinkExpires', { date: formatDateTime(link.expiresAt) }) : t('shareJam.policyLinkNever'), tone: !link ? 'warning' : undefined },
    { section: 'guests', icon: <Users />, label: t('shareJam.policyGuests'), value: guestCount === null ? '…' : String(guestCount) },
  ];

  return (
    <div className="flex flex-col gap-2" data-owner-panel="">
      <div className="flex flex-col gap-2 rounded-xl border bg-background/70 p-2 shadow-xs">
        <span className="px-1 pt-0.5 text-xs font-medium text-sidebar-foreground/70">{t('shareJam.sharingHeading')}</span>
        <ul className="flex flex-col" data-owner-policy="">
          {rows.map((row) => (
            <li key={row.section}>
              <button type="button" onClick={() => onOpenSettings(row.section)} aria-label={t('shareJam.policyChange', { setting: row.label })}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:outline-none [&_svg]:size-3.5 [&_svg]:shrink-0"
                data-owner-policy-row={row.section}>
                <span className="text-muted-foreground">{row.icon}</span>
                <span className="shrink-0 text-muted-foreground">{row.label}</span>
                <span className={cn('min-w-0 flex-1 truncate text-right font-medium', row.tone === 'warning' && 'text-warning')} title={row.value} data-owner-policy-value="">{row.value}</span>
                <ChevronRight className="text-muted-foreground/60" />
              </button>
            </li>
          ))}
        </ul>
        {link ? (
          <div className="flex flex-col gap-1">
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => void copy()} className="min-w-0 flex-1" data-owner-copy-link="">
                {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}<span className="truncate">{copied ? t('shareJam.guestLinkCopied') : t('shareJam.copyGuestLink')}</span>
              </Button>
              <WithTooltip label={t('shareJam.previewAsGuest')}>
                <Button size="sm" variant="outline" className="shrink-0 bg-background" onClick={onPreview} data-owner-preview="">
                  <Eye data-icon="inline-start" />{t('shareJam.previewShort')}
                </Button>
              </WithTooltip>
            </div>
            {copied && (
              <Button size="xs" variant="link" className="h-auto self-center py-0.5 text-xs" onClick={onPreview} data-owner-see-guests="">
                {t('shareJam.seeWhatGuestsSee')}
              </Button>
            )}
          </div>
        ) : (
          <button type="button" className="rounded-md border border-dashed px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-sidebar-accent" onClick={() => onOpenSettings(null)} data-owner-no-link="">
            {t('shareJam.noLink')}
          </button>
        )}
        <WithTooltip label={t('shareJam.ownerPageHelp')}>
          <span className="flex min-w-0 items-center gap-1 px-1 text-[11px] text-warning" tabIndex={0} data-owner-note="">
            <ShieldAlert className="size-3 shrink-0" /><span className="truncate">{t('shareJam.ownerNote')}</span>
          </span>
        </WithTooltip>
      </div>
      {saveCard}
    </div>
  );
}

/**
 * Next to the sharing block: the jam isn't in an account yet (lose the link,
 * lose the jam) with a way to save it — or a quiet "saved" line.
 */
export function SaveCard({ saved, signedIn, onSave }: { saved: boolean; signedIn: boolean; onSave: () => void }) {
  const t = useT();
  if (saved) {
    return (
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground" data-owner-saved="">
        <Check className="size-3.5 text-success" />{t('shareJam.savedLine')} ·{' '}
        <a href="/jams" className="font-medium text-foreground underline-offset-2 hover:underline">{t('jams.myJams')}</a>
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 py-1 pr-1 pl-2.5" data-owner-not-saved="">
      <WithTooltip label={t('shareJam.notSavedBody')}>
        <span className="min-w-0 flex-1 truncate text-xs" tabIndex={0}>
          {t('shareJam.notSavedShort')}<span className="sr-only">. {t('shareJam.notSavedBody')}</span>
        </span>
      </WithTooltip>
      <Button size="xs" variant="outline" className="shrink-0 bg-background" onClick={onSave} data-owner-save="">
        {signedIn ? <BookmarkPlus data-icon="inline-start" /> : <LogIn data-icon="inline-start" />}
        {signedIn ? t('shareJam.saveToJamsShort') : t('shareJam.signInToSave')}
      </Button>
    </div>
  );
}

/** Remembered per jam in this browser: a dismissed banner stays dismissed. */
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
        <Button variant="ghost" size="icon-xs" onClick={onDismiss} aria-label={t('shareJam.dismiss')} data-strip-dismiss=""><X /></Button>
      </AlertAction>
    </Alert>
  );
}

/** A live, scaled-down guest page (read-only preview) with "Open in new tab". */
export function GuestPreviewDialog({ open, onOpenChange, url, inviteOnly = false }: { open: boolean; onOpenChange: (open: boolean) => void; url: string | null; inviteOnly?: boolean }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl" data-guest-preview-dialog="">
        <DialogHeader>
          <DialogTitle>{t('shareJam.previewTitle')}</DialogTitle>
          <DialogDescription data-guest-preview-label="">{inviteOnly ? t('shareJam.previewInviteOnly') : t('shareJam.previewBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {url && (
            <div className="relative h-[60vh] w-full overflow-hidden rounded-lg border bg-muted sm:h-[540px]">
              {/* Rendered at desktop size and scaled down on wide screens; full size on phones. */}
              <iframe
                src={url}
                title={t('shareJam.previewTitle')}
                sandbox="allow-scripts allow-same-origin"
                className="absolute top-0 left-0 h-full w-full border-0 bg-background sm:h-[166.67%] sm:w-[166.67%] sm:origin-top-left sm:scale-[0.6]"
                data-guest-preview-frame=""
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
          {url && <Button asChild><a href={url} target="_blank" rel="noopener noreferrer" data-guest-preview-open=""><ExternalLink data-icon="inline-start" />{t('shareJam.openInNewTab')}</a></Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

