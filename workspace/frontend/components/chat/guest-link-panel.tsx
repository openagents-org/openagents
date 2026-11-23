'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2Off, Plus } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { ApiError, workspaceApi } from '@/lib/api';
import { useFormatters, useT, type MessageKey } from '@/lib/i18n';
import {
  EXPIRY_CHOICES,
  expiryForChoice,
  guestLinkState,
  upsertLink,
  type ExpiryChoice,
  type GuestLink,
  type GuestLinksClient,
} from '@/lib/guest-links';
import { GuestThreadError } from '@/lib/guest-thread-api';
import { cn } from '@/lib/utils';

/** The default client: the signed-in workspace API. */
export const workspaceGuestLinksClient: GuestLinksClient = {
  list: (channel) => workspaceApi.listGuestLinks(channel),
  create: (channel, expiresAt) => workspaceApi.createGuestLink(channel, expiresAt),
  updateExpiry: (id, expiresAt) => workspaceApi.updateGuestLinkExpiry(id, expiresAt),
  revoke: (id) => workspaceApi.revokeGuestLink(id),
};

function isForbidden(error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : error instanceof GuestThreadError ? error.status : null;
  return status === 401 || status === 403;
}

export type GuestLinksLoad = { links: GuestLink[] | null; error: 'forbidden' | 'failed' | null };

/** The thread's guest links, loaded while `enabled` (the share dialog is open). */
export function useGuestLinks(channel: string, enabled: boolean, client: GuestLinksClient = workspaceGuestLinksClient) {
  const [state, setState] = useState<GuestLinksLoad & { channel: string }>({ channel, links: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState({ channel, links: null, error: null });
    client.list(channel)
      .then((links) => { if (active) setState({ channel, links, error: null }); })
      .catch((error) => {
        if (!active) return;
        setState({ channel, links: null, error: isForbidden(error) ? 'forbidden' : 'failed' });
      });
    return () => { active = false; };
  }, [channel, enabled, client]);
  const current = state.channel === channel ? state : { links: null, error: null };
  const setLinks = (update: (links: GuestLink[]) => GuestLink[]) =>
    setState((prev) => ({ ...prev, links: update(prev.links || []), error: null }));
  return { links: current.links, error: current.error, setLinks };
}

const CHOICE_KEY: Record<ExpiryChoice, MessageKey> = {
  never: 'share.expiryNever',
  '1d': 'share.expiry1d',
  '7d': 'share.expiry7d',
  '30d': 'share.expiry30d',
};

/**
 * The owner's view of a shared thread's guest link: copy it, change when it
 * expires, turn it off, or make a new one. Lives in the thread's share dialog.
 */
export function GuestLinkPanel({ channel, agentName, links, error, setLinks, client = workspaceGuestLinksClient, compact = false }: {
  channel: string;
  /** Where link changes go; defaults to the signed-in workspace API. */
  client?: GuestLinksClient;
  /** Narrow layout (the owner room's side panel): link and copy stack. */
  compact?: boolean;
  /** The thread's agent, for "Guests can ask <agent> …"; null when unknown. */
  agentName: string | null;
  links: GuestLink[] | null;
  error: GuestLinksLoad['error'];
  setLinks: (update: (links: GuestLink[]) => GuestLink[]) => void;
}) {
  const t = useT();
  const { formatDateTime } = useFormatters();
  const copy = useCopyToClipboard();
  const [busy, setBusy] = useState<null | 'expiry' | 'revoke' | 'create'>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** The choice made here, so it stays highlighted (the server keeps a date). */
  const [picked, setPicked] = useState<{ linkId: string; choice: ExpiryChoice } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  if (error) {
    return <p className="text-sm text-muted-foreground" data-guest-link-error={error}>
      {error === 'forbidden' ? t('share.guestLinkForbidden') : t('share.guestLinkLoadFailed')}
    </p>;
  }
  if (!links) {
    return <div className="flex justify-center py-4"><Spinner className="size-5 text-muted-foreground" /></div>;
  }

  const state = guestLinkState(links);
  const run = async (kind: 'expiry' | 'revoke' | 'create', action: () => Promise<GuestLink>) => {
    setBusy(kind); setActionError(null);
    try {
      const link = await action();
      if (!mounted.current) return;
      setLinks((prev) => upsertLink(prev, link));
      return link;
    } catch {
      if (mounted.current) setActionError(t('share.guestLinkUpdateFailed'));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const hint = agentName ? t('share.guestLinkHint', { agent: agentName }) : t('share.guestLinkHintNoAgent');
  const failure = actionError && <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert>;

  if (state.kind !== 'live') {
    const message = state.kind === 'off' ? t('share.guestLinkOff')
      : state.kind === 'expired' ? t('share.guestLinkExpired', { date: formatDateTime(state.link.expiresAt!) })
      : t('share.guestLinkNone');
    return (
      <div className="flex flex-col gap-3" data-guest-link-state={state.kind}>
        <p className="text-sm text-muted-foreground">{message}</p>
        {failure}
        <div>
          <Button variant="outline" disabled={!!busy} onClick={() => void run('create', () => client.create(channel, null))}>
            {busy === 'create' ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}{t('share.createGuestLink')}
          </Button>
        </div>
      </div>
    );
  }

  const link = state.link;
  const activeChoice: ExpiryChoice | null = picked?.linkId === link.id ? picked.choice : link.expiresAt ? null : 'never';
  const setExpiry = async (choice: ExpiryChoice) => {
    const updated = await run('expiry', () => client.updateExpiry(link.id, expiryForChoice(choice)));
    if (updated && mounted.current) setPicked({ linkId: updated.id, choice });
  };
  const turnOff = async () => {
    const updated = await run('revoke', () => client.revoke(link.id));
    if (mounted.current) setConfirmOff(false);
    return updated;
  };

  return (
    <div className="flex flex-col gap-3" data-guest-link-state="live">
      <p className="text-sm text-muted-foreground">{hint}</p>
      <div className={cn('flex gap-2', compact && 'flex-col')}>
        <Input aria-label={t('share.guestLink')} readOnly value={link.url} className="select-all" onFocus={(e) => e.target.select()} />
        <Button onClick={() => copy.copyToClipboard(link.url)} className="shrink-0">
          {copy.isCopied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copy.isCopied ? t('common.copied') : t('share.copyLink')}
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t('share.guestLinkExpiry')}</span>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('share.guestLinkExpiry')}>
          {EXPIRY_CHOICES.map((choice) => (
            <Button key={choice} size="xs" variant={activeChoice === choice ? 'secondary' : 'outline'} aria-pressed={activeChoice === choice}
              data-expiry-choice={choice} disabled={!!busy} onClick={() => void setExpiry(choice)}>
              {t(CHOICE_KEY[choice])}
            </Button>
          ))}
          {busy === 'expiry' && <Spinner className="size-3.5 text-muted-foreground" />}
        </div>
        <span className="text-xs text-muted-foreground" data-guest-link-expiry="">
          {link.expiresAt ? t('share.guestLinkExpiresOn', { date: formatDateTime(link.expiresAt) }) : t('share.guestLinkNeverExpires')}
        </span>
      </div>
      {failure}
      {confirmOff ? (
        <Alert role="alertdialog" className="flex flex-col gap-2">
          <AlertDescription>{t('share.guestLinkTurnOffConfirm')}</AlertDescription>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={!!busy} onClick={() => void turnOff()}>
              {busy === 'revoke' ? <Spinner data-icon="inline-start" /> : <Link2Off data-icon="inline-start" />}{t('share.guestLinkTurnOff')}
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setConfirmOff(false)}>{t('common.cancel')}</Button>
          </div>
        </Alert>
      ) : (
        <div>
          <Button size="sm" variant="ghost" className="text-destructive" disabled={!!busy} onClick={() => setConfirmOff(true)}>
            <Link2Off data-icon="inline-start" />{t('share.guestLinkTurnOff')}
          </Button>
        </div>
      )}
    </div>
  );
}
