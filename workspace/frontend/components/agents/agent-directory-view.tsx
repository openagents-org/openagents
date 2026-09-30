'use client';

// ── v1.1 M2 — agent directory ────────────────────────────────────────────────
// "Team specialists you can hand work to": one card per agent the caller may
// see, with purpose, example requests, required inputs, whose credits it burns,
// live availability, a pin, "Start a request" (a fresh private thread) and —
// for owners/admins — a Manage drawer (profile + grants).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot, Coins, Loader2, MessageSquare, Pin, PinOff, Search, Send, Settings2, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { DetailHeader } from '@/components/layout/app-header';
import { useLayout } from '@/components/layout/layout-context';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { AgentManageSheet } from '@/components/agents/agent-manage-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { cn } from '@/lib/utils';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useMe } from '@/hooks/use-me';
import { useFormatters, useT } from '@/lib/i18n';
import {
  agentAvailability,
  availabilityDotClass,
  availabilityLabel,
  costOwnerDescriptor,
  displayNameFromEmail,
  sortDirectory,
  type AgentAvailability,
} from '@/lib/collab';
import type { AgentDirectoryEntry } from '@/lib/types';

/** `#?agent=<name>` — where a targeted invite lands. Consumed once. */
function requestedAgentFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  const q = hash.indexOf('?');
  if (q < 0) return null;
  return new URLSearchParams(hash.slice(q + 1)).get('agent');
}

function clearAgentHash() {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

/** The avatar dot only knows online/waiting/offline; busy still counts as online. */
function avatarStatus(availability: AgentAvailability): string {
  if (availability === 'waiting') return 'waiting';
  return availability === 'online' || availability === 'busy' ? 'online' : 'offline';
}

function entryToAvailabilityInput(e: AgentDirectoryEntry) {
  return {
    status: e.status,
    runtimeStatus: e.runtime_status,
    presenceState: e.presence_state,
    queueDepth: e.queue_depth,
    busyChannels: e.busy_channels,
  };
}

export function AgentDirectoryView() {
  const t = useT();
  const { timeAgo } = useFormatters();
  const { workspace, agents, pendingApprovalsByAgent, openSessionByChannel, setCurrentSessionId } = useWorkspace();
  const { openView, isMobile, openMobileDetail } = useLayout();
  const me = useMe(workspace?.slug || workspace?.workspaceId);

  const [entries, setEntries] = useState<AgentDirectoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [requestFor, setRequestFor] = useState<{ entry: AgentDirectoryEntry; prefill?: string } | null>(null);
  const [manageFor, setManageFor] = useState<AgentDirectoryEntry | null>(null);
  const [deepLinkAgent, setDeepLinkAgent] = useState<string | null>(() => requestedAgentFromHash());

  const load = useCallback(async () => {
    try {
      setEntries(await workspaceApi.getAgentDirectory());
      setFailed(false);
    } catch {
      setFailed(true);
      setEntries((prev) => prev ?? []);
    }
  }, []);

  // Availability is live: poll on the same cadence as the roster, and refetch
  // when an agent joins or leaves.
  const rosterSize = agents.length;
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load, rosterSize]);

  // Landing from a targeted invite: open the request dialog on that agent.
  useEffect(() => {
    if (!deepLinkAgent || !entries) return;
    const hit = entries.find((e) => e.agent_name === deepLinkAgent);
    if (hit) setRequestFor({ entry: hit });
    setDeepLinkAgent(null);
    clearAgentHash();
  }, [deepLinkAgent, entries]);

  const visible = useMemo(() => {
    if (!entries) return [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? entries.filter((e) =>
          [e.display_name, e.agent_name, e.purpose, e.owner_display_name, e.owner_email, ...(e.example_requests || [])]
            .some((v) => (v || '').toLowerCase().includes(q)))
      : entries;
    return sortDirectory(filtered.map((e) => ({ ...e, ...entryToAvailabilityInput(e) })));
  }, [entries, search]);

  const togglePin = async (entry: AgentDirectoryEntry) => {
    const next = !entry.pinned;
    setEntries((prev) => prev?.map((e) => (e.agent_name === entry.agent_name ? { ...e, pinned: next } : e)) ?? prev);
    try {
      await workspaceApi.setAgentPinned(entry.agent_name, next);
    } catch {
      setEntries((prev) => prev?.map((e) => (e.agent_name === entry.agent_name ? { ...e, pinned: !next } : e)) ?? prev);
      toast.error(t('collab.pinFailed'));
    }
  };

  const openThread = (channel: string) => {
    setCurrentSessionId(channel);
    openView('threads');
    if (isMobile) openMobileDetail();
  };

  const onRequestStarted = async (channel: string) => {
    setRequestFor(null);
    await openSessionByChannel(channel);
    openView('threads');
    if (isMobile) openMobileDetail();
    load();
  };

  return (
    <div className="h-full flex flex-col">
      <DetailHeader
        titleInHeader
        title={<>
          <h2 className="text-sm font-semibold">{t('collab.directoryTitle')}</h2>
          {entries && (
            <Badge variant="outline" size="sm" shape="circle">{entries.length}</Badge>
          )}
        </>}
      >
        <div className="relative hidden md:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            type="text"
            placeholder={t('collab.searchPlaceholder')}
            aria-label={t('collab.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 w-48 pl-8 text-xs lg:w-56"
          />
        </div>
      </DetailHeader>

      {/* Subtitle + mobile search */}
      <div className="shrink-0 border-b border-border px-5 py-2 space-y-2">
        <p className="text-xs text-muted-foreground">{t('collab.directorySubtitle')}</p>
        <div className="relative md:hidden">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t('collab.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-9 text-sm"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {entries === null ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : failed && entries.length === 0 ? (
          <p className="py-10 text-center text-sm text-destructive">{t('collab.directoryLoadFailed')}</p>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Bot className="size-5" />
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">{t('collab.directoryEmpty')}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {visible.map((entry) => (
              <DirectoryCard
                key={entry.agent_name}
                entry={entry}
                myEmail={me?.email ?? null}
                pendingApprovals={pendingApprovalsByAgent[entry.agent_name] ?? 0}
                timeAgo={timeAgo}
                onTogglePin={() => togglePin(entry)}
                onStartRequest={(prefill) => setRequestFor({ entry, prefill })}
                onManage={() => setManageFor(entry)}
                onOpenThread={openThread}
              />
            ))}
          </div>
        )}
      </div>

      {requestFor && (
        <StartRequestDialog
          entry={requestFor.entry}
          prefill={requestFor.prefill}
          onClose={() => setRequestFor(null)}
          onStarted={onRequestStarted}
        />
      )}

      {manageFor && (
        <AgentManageSheet
          entry={manageFor}
          open
          onOpenChange={(open) => { if (!open) setManageFor(null); }}
          onSaved={load}
        />
      )}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function DirectoryCard({
  entry, myEmail, pendingApprovals, timeAgo, onTogglePin, onStartRequest, onManage, onOpenThread,
}: {
  entry: AgentDirectoryEntry;
  myEmail: string | null;
  pendingApprovals: number;
  timeAgo: (iso: string) => string;
  onTogglePin: () => void;
  onStartRequest: (prefill?: string) => void;
  onManage: () => void;
  onOpenThread: (channel: string) => void;
}) {
  const t = useT();
  const availability = agentAvailability(entryToAvailabilityInput(entry), pendingApprovals);
  const name = entry.display_name?.trim() || entry.agent_name;
  const isMine = !!myEmail && !!entry.owner_email && myEmail.toLowerCase() === entry.owner_email.toLowerCase();
  const ownerLabel = entry.owner_email
    ? (entry.owner_display_name?.trim() || displayNameFromEmail(entry.owner_email))
    : null;
  const cost = costOwnerDescriptor(entry.cost_owner, entry.owner_email, entry.owner_display_name, myEmail);
  const costLabel = cost.kind === 'workspace'
    ? t('collab.costOwnerWorkspace')
    : cost.kind === 'yours'
      ? t('collab.costOwnerYours')
      : t('collab.costOwnerOwner', { owner: cost.owner });
  const recent = (entry.my_recent_requests || []).slice(0, 3);

  return (
    <div className={cn(
      'flex flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground',
      entry.pinned && 'border-primary/30',
    )}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <AgentAvatar name={entry.agent_name} size={36} status={avatarStatus(availability)} showStatus />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{name}</h3>
            <Badge
              variant={entry.visibility === 'personal' ? 'info' : 'secondary'}
              appearance="light"
              size="xs"
              className="shrink-0"
            >
              {entry.visibility === 'personal' ? t('collab.personal') : t('collab.team')}
            </Badge>
            {isMine && (
              <Badge variant="success" appearance="light" size="xs" className="shrink-0">{t('collab.yours')}</Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {ownerLabel ? t('collab.ownedBy', { owner: ownerLabel }) : t('collab.noOwner')}
            {entry.agent_type && <span> · <span className="capitalize">{entry.agent_type.replace('cloud:', '')}</span></span>}
          </p>
        </div>
        <button
          type="button"
          onClick={onTogglePin}
          title={entry.pinned ? t('collab.unpin') : t('collab.pin')}
          aria-pressed={entry.pinned}
          className={cn(
            'shrink-0 rounded-md p-1.5 transition-colors hover:bg-muted',
            entry.pinned ? 'text-primary' : 'text-muted-foreground/60 hover:text-foreground',
          )}
        >
          {entry.pinned ? <Pin className="size-4 fill-current" /> : <PinOff className="size-4" />}
        </button>
      </div>

      {/* Purpose */}
      <p className={cn('text-sm leading-relaxed', !entry.purpose && 'italic text-muted-foreground')}>
        {entry.purpose || t('collab.purposeMissing')}
      </p>

      {/* Availability + cost */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn('size-2 rounded-full', availabilityDotClass(availability))} />
          {availabilityLabel(t, availability, entry.queue_depth)}
          {availability === 'device_offline' && entry.runtime_name && (
            <span className="text-muted-foreground/70">· {entry.runtime_name}</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Coins className="size-3.5" />
          {costLabel}
        </span>
        {entry.grant_count > 0 && (
          <span>{t('collab.grantCount', { count: entry.grant_count })}</span>
        )}
      </div>

      {/* Example requests → prefill */}
      {entry.example_requests?.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Sparkles className="size-3" /> {t('collab.exampleRequests')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {entry.example_requests.slice(0, 4).map((ex, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onStartRequest(ex)}
                className="max-w-full truncate rounded-full border border-border bg-muted/40 px-2.5 py-1 text-left text-xs transition-colors hover:bg-muted"
                title={ex}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Required inputs */}
      {entry.required_inputs && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{t('collab.requiredInputs')}:</span> {entry.required_inputs}
        </p>
      )}

      {/* Recent requests */}
      {recent.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('collab.recentRequests')}</p>
          <ul className="space-y-0.5">
            {recent.map((r) => (
              <li key={r.channel}>
                <button
                  type="button"
                  onClick={() => onOpenThread(r.channel)}
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
                >
                  <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{r.title || r.channel}</span>
                  {r.last_event_at && (
                    <span className="shrink-0 text-muted-foreground/70">
                      {timeAgo(typeof r.last_event_at === 'number' ? new Date(r.last_event_at).toISOString() : r.last_event_at)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button size="sm" className="flex-1" onClick={() => onStartRequest()}>
          <Send className="size-3.5" />
          {t('collab.startRequest')}
        </Button>
        {entry.can_manage && (
          <Button size="sm" variant="outline" onClick={onManage}>
            <Settings2 className="size-3.5" />
            {t('collab.manage')}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Start a request ──────────────────────────────────────────────────────────

function StartRequestDialog({
  entry, prefill, onClose, onStarted,
}: {
  entry: AgentDirectoryEntry;
  prefill?: string;
  onClose: () => void;
  onStarted: (channel: string) => void | Promise<void>;
}) {
  const t = useT();
  const name = entry.display_name?.trim() || entry.agent_name;
  const [content, setContent] = useState(prefill || '');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await workspaceApi.startAgentRequest(entry.agent_name, text, title.trim() || undefined);
      toast.success(t('collab.requestStarted', { agent: name }));
      await onStarted(res.channel);
    } catch {
      toast.error(t('collab.requestFailed'));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-3 px-7 pt-7 pb-2">
          <DialogTitle className="text-xl">{t('collab.requestTitle', { agent: name })}</DialogTitle>
          <DialogDescription className="text-[15px] leading-relaxed">
            {t('collab.requestDescription', { agent: name })}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 px-7 py-2">
          <Textarea
            autoFocus
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('collab.requestPlaceholder')}
            rows={5}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
          {entry.required_inputs && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">{t('collab.requiredInputs')}:</span> {entry.required_inputs}
            </p>
          )}
          <div className="space-y-1.5">
            <Label variant="secondary">{t('collab.requestTitleLabel')}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>
        </DialogBody>
        <DialogFooter className="px-7 pt-7 pb-7 sm:space-x-3">
          <Button variant="outline" className="min-w-24" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button className="min-w-24" onClick={submit} disabled={busy || !content.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            {busy ? t('collab.requestSending') : t('collab.requestSend')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
