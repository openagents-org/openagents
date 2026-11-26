'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Globe, Link2Off, Lock, Plus, UserX, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GuestThreadError } from '@/lib/guest-thread-api';
import { Spinner } from '@/components/ui/spinner';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { ApiError, workspaceApi } from '@/lib/api';
import { useFormatters, useT, type MessageKey } from '@/lib/i18n';
import {
  EXPIRY_CHOICES,
  expiryForChoice,
  guestLinkState,
  upsertLink,
  type ApprovalMode,
  type ExpiryChoice,
  type GuestLink,
  type LinkAccess,
  type ThreadGuestRecord,
  type GuestLinksClient,
} from '@/lib/guest-links';
import { cn } from '@/lib/utils';

/** The default client: the signed-in workspace API. */
export const workspaceGuestLinksClient: GuestLinksClient = {
  list: (channel) => workspaceApi.listGuestLinks(channel),
  create: (channel, expiresAt) => workspaceApi.createGuestLink(channel, expiresAt),
  updateExpiry: (id, expiresAt) => workspaceApi.updateGuestLinkExpiry(id, expiresAt),
  revoke: (id) => workspaceApi.revokeGuestLink(id),
  updateApprovalMode: (id, mode) => workspaceApi.updateGuestLinkApprovalMode(id, mode),
  updateCanPost: (id, canPost) => workspaceApi.updateGuestLinkCanPost(id, canPost),
  updateAccess: (id, access) => workspaceApi.updateGuestLinkAccess(id, access),
  updateAllowGuestAgents: (id, allow) => workspaceApi.updateGuestLinkAllowGuestAgents(id, allow),
  addInvites: (id, emails) => workspaceApi.addGuestLinkInvites(id, emails),
  removeInvite: (id, email) => workspaceApi.removeGuestLinkInvite(id, email),
  listGuests: (channel) => workspaceApi.listThreadGuests(channel),
  removeGuest: (channel, guestId) => workspaceApi.removeThreadGuest(channel, guestId),
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
  /** Narrow layout (the owner page's side panel): link and copy stack. */
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
  const [busy, setBusy] = useState<null | 'expiry' | 'revoke' | 'create' | 'approval' | 'post' | 'agents'>(null);
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
  const run = async (kind: 'expiry' | 'revoke' | 'create' | 'approval' | 'post' | 'agents', action: () => Promise<GuestLink>) => {
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

  const live = state.kind === 'live' ? state.link : null;
  // What a guest can do with this link, as set below.
  const hint = live && !live.canPost ? t('share.guestLinkHintReadOnly')
    : live?.approvalMode === 'off' ? t('share.guestLinkHintOff')
    : agentName ? t('share.guestLinkHint', { agent: agentName }) : t('share.guestLinkHintNoAgent');
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
  const setApproval = (mode: ApprovalMode) => {
    if (!client.updateApprovalMode || mode === (link.approvalMode ?? 'none')) return;
    const update = client.updateApprovalMode.bind(client);
    void run('approval', () => update(link.id, mode));
  };
  const setCanPost = (canPost: boolean) => {
    if (!client.updateCanPost || canPost === link.canPost) return;
    const update = client.updateCanPost.bind(client);
    void run('post', () => update(link.id, canPost));
  };
  const setAllowAgents = (allow: boolean) => {
    if (!client.updateAllowGuestAgents || allow === !!link.allowGuestAgents) return;
    const update = client.updateAllowGuestAgents.bind(client);
    void run('agents', () => update(link.id, allow));
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
      {client.updateAccess && <GeneralAccess link={link} client={client} setLinks={setLinks} />}
      {client.updateCanPost && (
        <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border px-3 py-2.5" data-guest-link-section="post" data-guest-link-can-post={link.canPost ? 'on' : 'off'}>
          <span className="grid gap-0.5">
            <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">{t('share.canPost')}{busy === 'post' && <Spinner className="size-3.5" />}</span>
            <span className="text-xs text-muted-foreground">{link.canPost ? t('share.canPostOnBody') : t('share.canPostOffBody')}</span>
          </span>
          <Switch checked={link.canPost} disabled={!!busy} onCheckedChange={setCanPost} aria-label={t('share.canPost')} data-can-post-switch="" />
        </label>
      )}
      {client.updateAllowGuestAgents && (
        <label className={cn('flex cursor-pointer items-start justify-between gap-3 rounded-lg border px-3 py-2.5', !link.canPost && 'opacity-60')} data-guest-link-section="agents" data-guest-link-agents={link.allowGuestAgents ? 'on' : 'off'}>
          <span className="grid gap-0.5">
            <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">{t('jamAgents.allowGuestAgents')}{busy === 'agents' && <Spinner className="size-3.5" />}</span>
            <span className="text-xs text-muted-foreground">{t('jamAgents.allowGuestAgentsBody')}</span>
          </span>
          <Switch checked={!!link.allowGuestAgents} disabled={!!busy || !link.canPost} onCheckedChange={setAllowAgents} aria-label={t('jamAgents.allowGuestAgents')} data-allow-agents-switch="" />
        </label>
      )}
      {client.updateApprovalMode && (
        <ApprovalChoice mode={link.approvalMode ?? 'none'} agentName={agentName} busy={busy === 'approval'} disabled={!!busy || !link.canPost} onChange={setApproval} />
      )}
      <div className="flex flex-col gap-1.5" data-guest-link-section="expiry">
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
      {client.listGuests && client.removeGuest && <GuestsSection channel={channel} client={client} />}
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

/** Whether a guest's request to the agent runs right away or waits for the owner. */
function ApprovalChoice({ mode, agentName, busy, disabled, onChange }: {
  mode: ApprovalMode;
  agentName: string | null;
  busy: boolean;
  disabled: boolean;
  onChange: (mode: ApprovalMode) => void;
}) {
  const t = useT();
  const agent = agentName || t('share.guestLinkAgentFallback');
  const options: { value: ApprovalMode; title: string; body: string }[] = [
    { value: 'none', title: t('share.approvalNone'), body: t('share.approvalNoneBody', { agent }) },
    { value: 'owner', title: t('share.approvalOwner'), body: t('share.approvalOwnerBody') },
    { value: 'off', title: t('share.approvalOff', { agent }), body: t('share.approvalOffBody') },
  ];
  return (
    <div className="flex flex-col gap-1.5" data-guest-link-section="requests" data-guest-link-approval={mode}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {t('share.approvalHeading')}
        {busy && <Spinner className="size-3.5" />}
      </span>
      <RadioGroup value={mode} onValueChange={(value) => onChange(value as ApprovalMode)} disabled={disabled} aria-label={t('share.approvalHeading')} className="gap-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/50 has-disabled:cursor-default has-disabled:opacity-60',
              mode === option.value && 'border-primary/40 bg-muted/40',
            )}
          >
            <RadioGroupItem value={option.value} className="mt-0.5" data-approval-choice={option.value} />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium leading-tight">{option.title}</span>
              <span className="text-xs text-muted-foreground">{option.body}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

/**
 * The thread's guests, with "Remove" (after a confirm). A removed guest can
 * still read the thread but can no longer post or ask the agent.
 */
function GuestsSection({ channel, client }: { channel: string; client: GuestLinksClient }) {
  const t = useT();
  const [guests, setGuests] = useState<ThreadGuestRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    client.listGuests!(channel)
      .then((list) => { if (active) setGuests(list); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [channel, client]);
  const remove = async (guest: ThreadGuestRecord) => {
    setBusy(guest.id); setError(null);
    try {
      const updated = await client.removeGuest!(channel, guest.id);
      setGuests((prev) => (prev || []).map((g) => (g.id === guest.id ? { ...g, ...updated, removed: true } : g)));
      setConfirm(null);
    } catch {
      setError(t('share.guestRemoveFailed'));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-1.5" data-guest-link-section="guests" data-guest-link-guests="">
      <span className="text-xs font-medium text-muted-foreground">{t('share.guestsHeading', { count: guests?.length ?? 0 })}</span>
      {failed ? <p className="text-xs text-muted-foreground">{t('share.guestsLoadFailed')}</p>
        : !guests ? <Spinner className="size-4 text-muted-foreground" />
        : guests.length === 0 ? <p className="text-xs text-muted-foreground">{t('share.guestsEmpty')}</p>
        : (
          <ul className="flex max-h-48 flex-col divide-y overflow-y-auto rounded-lg border">
            {guests.map((guest) => (
              <li key={guest.id} className="flex flex-col gap-1.5 px-3 py-2" data-guest-row={guest.id}>
                <div className="flex items-center gap-2">
                  <span className={cn('min-w-0 flex-1 truncate text-sm', guest.removed && 'text-muted-foreground line-through')}>{guest.name}</span>
                  {guest.removed
                    ? <span className="shrink-0 text-xs text-muted-foreground" data-guest-removed="">{t('share.guestRemoved')}</span>
                    : confirm !== guest.id && (
                      <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setConfirm(guest.id)} data-guest-remove={guest.id}>
                        <UserX data-icon="inline-start" />{t('share.guestRemove')}
                      </Button>
                    )}
                </div>
                {confirm === guest.id && !guest.removed && (
                  <div className="flex flex-wrap items-center gap-2" role="alertdialog">
                    <span className="min-w-0 flex-1 text-xs text-muted-foreground">{t('share.guestRemoveConfirm', { name: guest.name })}</span>
                    <Button size="xs" variant="destructive" disabled={busy === guest.id} onClick={() => void remove(guest)} data-guest-remove-confirm={guest.id}>
                      {busy === guest.id && <Spinner data-icon="inline-start" />}{t('share.guestRemove')}
                    </Button>
                    <Button size="xs" variant="outline" disabled={busy === guest.id} onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** Split typed or pasted text into addresses (commas, semicolons, spaces). */
export function splitEmails(text: string): string[] {
  return text.split(/[\s,;]+/).map((e) => e.trim().replace(/^<|>$/g, '')).filter(Boolean);
}

export function isEmail(value: string): boolean {
  return EMAIL.test(value);
}

/**
 * Who can open the jam, like Google Docs' "General access": anyone with the
 * link, or only people invited by email (who sign in with that address).
 * Adding people sends them the link by email.
 */
function GeneralAccess({ link, client, setLinks }: {
  link: GuestLink;
  client: GuestLinksClient;
  setLinks: (update: (links: GuestLink[]) => GuestLink[]) => void;
}) {
  const t = useT();
  const access: LinkAccess = link.access ?? 'link';
  const invited = link.invitedEmails ?? [];
  const [chips, setChips] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'access' | 'invite' | string>(null);

  /** Turn what's typed into chips; returns false (and says why) on a bad address. */
  const commit = (raw = text): string[] | null => {
    const parts = splitEmails(raw);
    if (!parts.length) return chips;
    const bad = parts.find((e) => !isEmail(e));
    if (bad) { setError(t('share.inviteInvalid', { email: bad })); return null; }
    const next = [...chips];
    for (const e of parts.map((p) => p.toLowerCase())) if (!next.includes(e)) next.push(e);
    setChips(next);
    setText('');
    setError(null);
    return next;
  };

  const setAccess = async (value: LinkAccess) => {
    if (value === access || !client.updateAccess) return;
    setBusy('access'); setError(null);
    try {
      const updated = await client.updateAccess(link.id, value);
      setLinks((prev) => upsertLink(prev, updated));
    } catch {
      setError(t('share.guestLinkUpdateFailed'));
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    const emails = commit();
    if (!emails || !emails.length || !client.addInvites) return;
    setBusy('invite'); setError(null); setNotice(null);
    try {
      const result = await client.addInvites(link.id, emails);
      setLinks((prev) => upsertLink(prev, result.link));
      setChips([]);
      setNotice(t('share.inviteSent', { count: result.added.length || emails.length }));
    } catch (e) {
      // A bad address comes back as a 400 with the server's own explanation.
      const message = e instanceof GuestThreadError && e.status === 400 ? e.message
        : e instanceof ApiError && e.status === 400 ? e.serverMessage : '';
      setError(message || t('share.inviteFailed'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (email: string) => {
    if (!client.removeInvite) return;
    setBusy(email); setError(null);
    try {
      const updated = await client.removeInvite(link.id, email);
      setLinks((prev) => upsertLink(prev, updated));
    } catch {
      setError(t('share.guestLinkUpdateFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-guest-link-section="access" data-guest-link-access={access}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {t('share.generalAccess')}{busy === 'access' && <Spinner className="size-3.5" />}
      </span>
      <div className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
        <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', access === 'invited' ? 'bg-muted text-foreground' : 'bg-success/15 text-success')}>
          {access === 'invited' ? <Lock className="size-4" /> : <Globe className="size-4" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Select value={access} onValueChange={(value) => void setAccess(value as LinkAccess)} disabled={!!busy}>
            <SelectTrigger size="sm" className="h-7 w-fit border-0 px-1.5 text-sm font-medium shadow-none hover:bg-muted" aria-label={t('share.generalAccess')} data-access-select="">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="link" data-access-option="link">{t('share.accessLink')}</SelectItem>
              <SelectItem value="invited" data-access-option="invited">{t('share.accessInvitedLong')}</SelectItem>
            </SelectContent>
          </Select>
          <span className="px-1.5 text-xs text-muted-foreground">{access === 'invited' ? t('share.accessInvitedBody') : t('share.accessLinkBody')}</span>
        </div>
      </div>
      {client.addInvites && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <div className={cn('flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-1 rounded-md border bg-transparent px-2 py-1 focus-within:ring-2 focus-within:ring-ring/50', error && 'border-destructive')}>
              {chips.map((chip) => (
                <span key={chip} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2 text-xs" data-invite-chip={chip}>
                  {chip}
                  <button type="button" className="rounded-full p-0.5 hover:bg-background" aria-label={t('share.removeInvite', { email: chip })} onClick={() => setChips(chips.filter((c) => c !== chip))}><X className="size-3" /></button>
                </span>
              ))}
              <input
                value={text}
                onChange={(e) => {
                  const value = e.target.value;
                  // A comma (typed or pasted) ends an address.
                  if (/[,;]/.test(value)) { const lastSep = Math.max(value.lastIndexOf(','), value.lastIndexOf(';')); if (commit(value.slice(0, lastSep))) setText(value.slice(lastSep + 1).trimStart()); else setText(value); return; }
                  setText(value); setError(null); setNotice(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); if (text.trim()) commit(); else void invite(); }
                  if (e.key === 'Backspace' && !text && chips.length) setChips(chips.slice(0, -1));
                }}
                onBlur={() => { if (text.trim()) commit(); }}
                placeholder={chips.length ? '' : t('share.addPeoplePlaceholder')}
                aria-label={t('share.addPeople')}
                aria-invalid={!!error || undefined}
                className="min-w-32 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
                data-invite-input=""
              />
            </div>
            <Button size="sm" className="shrink-0" disabled={busy === 'invite' || (!chips.length && !text.trim())} onClick={() => void invite()} data-invite-send="">
              {busy === 'invite' && <Spinner data-icon="inline-start" />}{t('share.invite')}
            </Button>
          </div>
          {error && <p className="text-xs text-destructive" role="alert" data-invite-error="">{error}</p>}
          {notice && <p className="text-xs text-success" role="status">{notice}</p>}
          <span className="text-xs font-medium text-muted-foreground">{t('share.invited', { count: invited.length })}</span>
          {invited.length === 0 ? <p className="text-xs text-muted-foreground">{t('share.invitedNone')}</p> : (
            <ul className="flex max-h-40 flex-col divide-y overflow-y-auto rounded-lg border" data-invited-list="">
              {invited.map((email) => (
                <li key={email} className="flex items-center gap-2 px-3 py-1.5 text-sm" data-invited={email}>
                  <span className="min-w-0 flex-1 truncate">{email}</span>
                  <Button variant="ghost" size="icon-xs" className="text-muted-foreground" disabled={busy === email} onClick={() => void remove(email)} aria-label={t('share.removeInvite', { email })} data-invite-remove={email}>
                    {busy === email ? <Spinner /> : <X />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
