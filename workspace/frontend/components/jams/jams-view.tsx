'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Check, Copy, ExternalLink, FolderInput, Globe, LayoutGrid, LayoutList, Link2, Lock, LogIn, MoreHorizontal, RefreshCw, Settings2, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { useGuestLinks } from '@/components/chat/guest-link-panel';
import { GuestLinkDialog } from '@/components/share/guest-link-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { getApiBaseUrl } from '@/lib/api-base';
import { goToCentralLogin } from '@/lib/auth-redirects';
import { agentDisplayName } from '@/lib/guest-thread';
import { useFormatters, useT } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import {
  deleteJam,
  importShare,
  keepAsWorkspace,
  listMyJams,
  listMyWorkspaces,
  jamGuestLinksClient,
  threadPath,
  type MyJam,
  type MyWorkspace,
  type JamCredentials,
} from '@/lib/jam-api';
import { cn } from '@/lib/utils';

function defaultNavigate(href: string) {
  window.location.assign(href);
}

/** The copyable one-liner that makes a jam from a coding agent's session. */
export function shareInstruction(t: ReturnType<typeof useT>, apiBase = getApiBaseUrl()): string {
  return t('jams.instruction', { url: `${apiBase.replace(/\/+$/, '')}/v1/share/instructions` });
}

/**
 * "My jams": every jam the signed-in person owns — the conversation, its
 * agent and its guest link — with open, share, link settings, keep as a
 * workspace, add to a workspace and delete. Jams kept as workspaces sit in
 * their own short section.
 */
export function JamsView({ navigate = defaultNavigate }: { navigate?: (href: string) => void }) {
  const t = useT();
  const { user, idToken, loading, signIn } = useOpenAgentsAuth();
  const [jams, setJams] = useState<MyJam[] | null>(null);
  const [failed, setFailed] = useState(false);
  const idTokenRef = useRef(idToken);
  idTokenRef.current = idToken;
  const signedIn = !!user && !!idToken;

  const load = useCallback(async () => {
    const token = idTokenRef.current;
    if (!token) return;
    setFailed(false);
    try {
      setJams(await listMyJams(token));
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { if (signedIn) void load(); }, [signedIn, load]);

  const creds = useCallback((jam: MyJam): JamCredentials => ({ slug: jam.workspace.slug, idToken: () => idTokenRef.current }), []);
  const active = useMemo(() => (jams || []).filter((r) => !r.keptAsWorkspace), [jams]);
  const kept = useMemo(() => (jams || []).filter((r) => r.keptAsWorkspace), [jams]);

  let body: React.ReactNode;
  if (loading) {
    body = <JamsSkeleton />;
  } else if (!signedIn) {
    body = (
      <Empty className="py-16" data-jams-state="sign-in">
        <EmptyHeader>
          <EmptyMedia variant="icon"><LayoutList /></EmptyMedia>
          <EmptyTitle>{t('jams.signInTitle')}</EmptyTitle>
          <EmptyDescription>{t('jams.signInBody')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => goToCentralLogin(() => { void signIn(); })} data-jams-sign-in=""><LogIn data-icon="inline-start" />{t('jams.signIn')}</Button>
        </EmptyContent>
      </Empty>
    );
  } else if (failed) {
    body = (
      <Empty className="py-16" data-jams-state="error">
        <EmptyHeader><EmptyTitle>{t('jams.loadFailed')}</EmptyTitle></EmptyHeader>
        <EmptyContent><Button variant="outline" onClick={() => void load()}><RefreshCw data-icon="inline-start" />{t('jams.retry')}</Button></EmptyContent>
      </Empty>
    );
  } else if (!jams) {
    body = <JamsSkeleton />;
  } else if (jams.length === 0) {
    body = <JamsEmpty />;
  } else {
    body = (
      <div className="flex flex-col gap-8">
        {active.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label={t('jams.title')} data-jams-list="">
            {active.map((jam) => (
              <JamRow key={jam.workspace.slug} jam={jam} creds={creds(jam)} navigate={navigate}
                onChanged={() => void load()} onDeleted={() => setJams((prev) => (prev || []).filter((r) => r.workspace.slug !== jam.workspace.slug))} />
            ))}
          </ul>
        )}
        {active.length === 0 && <JamsEmpty />}
        {kept.length > 0 && (
          <section className="flex flex-col gap-2" aria-label={t('jams.keptHeading')} data-jams-kept="">
            <div>
              <h2 className="text-sm font-medium">{t('jams.keptHeading')}</h2>
              <p className="text-xs text-muted-foreground">{t('jams.keptBody')}</p>
            </div>
            <ul className="flex flex-col gap-2">
              {kept.map((jam) => (
                <li key={jam.workspace.slug} className="flex items-center gap-3 rounded-xl border bg-background px-4 py-3" data-jam={jam.workspace.slug}>
                  <LayoutGrid className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{jam.thread.title || jam.thread.name}</span>
                  <Button size="sm" variant="outline" asChild data-jam-open-workspace="">
                    <a href={threadPath(jam.workspace.slug, jam.thread.name)}><ExternalLink data-icon="inline-start" />{t('jams.openWorkspace')}</a>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background lg:bg-sidebar lg:p-2">
      <div className="flex min-h-0 flex-1 flex-col lg:rounded-xl lg:border lg:bg-background">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 lg:h-12">
          <a href="/" className="flex items-center gap-2" aria-label="OpenAgents">
            <span className="flex size-5 items-center justify-center overflow-hidden">
              <Image src="/logo-black.png" alt="" width={20} height={20} className="size-full object-contain dark:hidden" />
              <Image src="/logo-white.png" alt="" width={20} height={20} className="hidden size-full object-contain dark:block" />
            </span>
          </a>
          <h1 className="font-heading text-base font-medium">{t('jams.title')}</h1>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 lg:px-8">
          <p className="mb-5 text-sm text-muted-foreground">{t('jams.subtitle')}</p>
          {body}
        </main>
      </div>
    </div>
  );
}

function JamsSkeleton() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-busy="true" data-jams-state="loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border p-4">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-72" /></div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

function JamsEmpty() {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const instruction = shareInstruction(t);
  return (
    <Empty className="rounded-xl border border-dashed py-12" data-jams-state="empty">
      <EmptyHeader>
        <EmptyMedia variant="icon"><LayoutList /></EmptyMedia>
        <EmptyTitle>{t('jams.emptyTitle')}</EmptyTitle>
        <EmptyDescription>{t('jams.emptyBody')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="w-full max-w-xl">
        <div className="flex w-full items-start gap-2 rounded-lg border bg-muted/40 p-3 text-left">
          <code className="min-w-0 flex-1 break-words font-mono text-xs leading-5" data-jams-instruction="">{instruction}</code>
          <Button size="xs" variant="outline" onClick={() => {
            void navigator.clipboard?.writeText(instruction).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
          }}>
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copied ? t('jams.copied') : t('jams.copyInstruction')}
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}

function linkStatus(jam: MyJam, t: ReturnType<typeof useT>, formatDateTime: (iso: string) => string): { text: string; live: boolean } {
  const link = jam.liveLink;
  if (!link) return { text: t('jams.linkOff'), live: false };
  return { text: link.expiresAt ? t('jams.linkExpires', { date: formatDateTime(link.expiresAt) }) : t('jams.linkLive'), live: true };
}

/** One jam: what it is and how it's doing, Open, and the rest in a menu. */
function JamRow({ jam, creds, navigate, onChanged, onDeleted }: {
  jam: MyJam;
  creds: JamCredentials;
  navigate: (href: string) => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const { formatDateTime, timeAgoShort } = useFormatters();
  const confirm = useConfirm();
  const [linkOpen, setLinkOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [busy, setBusy] = useState<null | 'workspace' | 'delete'>(null);
  const title = jam.thread.title || jam.thread.name;
  const agent = jam.agents[0] ?? null;
  const status = linkStatus(jam, t, formatDateTime);
  const ownerHref = `/jam/own/${encodeURIComponent(jam.workspace.slug)}`;

  const copyLink = async () => {
    if (!jam.liveLink) return;
    try {
      await navigator.clipboard.writeText(jam.liveLink.url);
      toast.success(t('jams.linkCopied'));
    } catch {
      toast.error(t('jams.actionFailed'));
    }
  };
  const makeWorkspace = async () => {
    setBusy('workspace');
    try {
      const result = await keepAsWorkspace(creds);
      navigate(threadPath(result.workspace.slug || jam.workspace.slug, result.channel.name || jam.thread.name));
    } catch {
      toast.error(t('jams.actionFailed'));
      setBusy(null);
    }
  };
  const remove = async () => {
    const ok = await confirm({ title: t('jams.deleteTitle', { title }), description: t('jams.deleteBody'), confirmText: t('jams.deleteConfirm'), destructive: true });
    if (!ok) return;
    setBusy('delete');
    try {
      await deleteJam(creds);
      toast.success(t('jams.deleted'));
      onDeleted();
    } catch {
      toast.error(t('jams.actionFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="group/jam flex items-center gap-3 rounded-xl border bg-background p-3 transition-colors hover:bg-muted/30 sm:p-4" data-jam={jam.workspace.slug}>
      <a href={ownerHref} className="flex min-w-0 flex-1 items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md" data-jam-open="">
        {agent
          ? <AgentAvatar name={agent.name} size={36} showStatus status={agent.online ? 'online' : 'offline'} />
          : <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted"><LayoutList className="size-4 text-muted-foreground" /></span>}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{title}</span>
            {jam.pendingRequests > 0 && <Badge variant="warning" className="shrink-0" data-jam-pending="">{t('jams.pending', { count: jam.pendingRequests })}</Badge>}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {agent && <span data-jam-agent="">{agentDisplayName(agent)}</span>}
            <span>{jam.lastActivityAt ? t('jams.activity', { time: timeAgoShort(new Date(jam.lastActivityAt).toISOString()) }) : t('jams.noActivity')}</span>
            <span className="inline-flex items-center gap-1"><Users className="size-3" />{t('jams.guests', { count: jam.guestCount })}</span>
            {jam.liveLink && (
              <span className="inline-flex items-center gap-1" data-jam-access={jam.liveLink.access === 'invited' ? 'invited' : 'link'}>
                {jam.liveLink.access === 'invited' ? <Lock className="size-3" /> : <Globe className="size-3" />}
                {jam.liveLink.access === 'invited' ? t('jams.accessInvited') : t('jams.accessLink')}
              </span>
            )}
            <span className={cn('inline-flex items-center gap-1', status.live ? 'text-foreground/70' : 'text-muted-foreground/70')} data-jam-link={status.live ? 'live' : 'off'}>
              <Link2 className="size-3" />{status.text}
            </span>
          </span>
        </span>
      </a>
      <Button size="sm" variant="outline" asChild className="hidden sm:inline-flex">
        <a href={ownerHref}>{t('jams.open')}</a>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t('jams.more', { title })} disabled={!!busy} data-jam-menu="">
            {busy ? <Spinner /> : <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem disabled={!jam.liveLink} onSelect={() => void copyLink()} data-jam-action="copy"><Copy />{t('jams.copyLink')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setLinkOpen(true)} data-jam-action="settings"><Settings2 />{t('jams.linkSettings')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void makeWorkspace()} data-jam-action="workspace"><LayoutGrid />{t('jams.makeWorkspace')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPickOpen(true)} data-jam-action="import"><FolderInput />{t('jams.addToWorkspace')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => void remove()} data-jam-action="delete"><Trash2 />{t('jams.delete')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {linkOpen && <JamLinkDialog jam={jam} creds={creds} onClose={() => { setLinkOpen(false); onChanged(); }} />}
      {pickOpen && <AddToWorkspaceDialog jam={jam} creds={creds} navigate={navigate} onClose={() => setPickOpen(false)} />}
    </li>
  );
}

/** The guest-link panel for one jam, with the owner's sign-in. */
function JamLinkDialog({ jam, creds, onClose }: { jam: MyJam; creds: JamCredentials; onClose: () => void }) {
  const client = useMemo(() => jamGuestLinksClient(creds), [creds]);
  const links = useGuestLinks(jam.thread.name, true, client);
  const agent = jam.agents[0];
  return (
    <GuestLinkDialog open onOpenChange={(open) => { if (!open) onClose(); }} channel={jam.thread.name}
      agentName={agent ? agentDisplayName(agent) : null} links={links.links} error={links.error} setLinks={links.setLinks} client={client} />
  );
}

/** Merge the jam into one of the person's workspaces. */
function AddToWorkspaceDialog({ jam, creds, navigate, onClose }: { jam: MyJam; creds: JamCredentials; navigate: (href: string) => void; onClose: () => void }) {
  const t = useT();
  const [workspaces, setWorkspaces] = useState<MyWorkspace[] | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bearer = () => (typeof creds.idToken === 'function' ? creds.idToken() : creds.idToken) || '';
  useEffect(() => {
    let active = true;
    listMyWorkspaces(bearer())
      .then((list) => {
        if (!active) return;
        const others = list.filter((w) => w.slug !== jam.workspace.slug && w.workspaceId !== jam.workspace.id);
        setWorkspaces(others);
        if (others.length === 1) setTarget(others[0].workspaceId);
      })
      .catch(() => { if (active) { setWorkspaces([]); setError(t('jams.actionFailed')); } });
    return () => { active = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const move = async () => {
    if (!target) return;
    setBusy(true); setError(null);
    try {
      const result = await importShare(creds, target, bearer());
      navigate(threadPath(result.workspace.slug, result.channel.name));
    } catch {
      setError(t('jams.actionFailed'));
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-jam-import-dialog="">
        <DialogHeader>
          <DialogTitle>{t('jams.pickWorkspaceTitle')}</DialogTitle>
          <DialogDescription>{t('jams.pickWorkspaceBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {!workspaces && <div className="flex justify-center py-4"><Spinner className="size-5 text-muted-foreground" /></div>}
          {workspaces && workspaces.length === 0 && !error && <p className="text-sm text-muted-foreground">{t('jams.noWorkspaces')}</p>}
          {workspaces && workspaces.length > 0 && (
            <div role="radiogroup" aria-label={t('jams.pickWorkspaceTitle')} className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {workspaces.map((w) => (
                <button key={w.workspaceId} type="button" role="radio" aria-checked={target === w.workspaceId} disabled={busy}
                  onClick={() => setTarget(w.workspaceId)} data-jam-target={w.workspaceId}
                  className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted', target === w.workspaceId && 'border-primary/50 bg-primary/5')}>
                  <span className="min-w-0 flex-1 truncate">{w.name || w.slug}</span>
                  {target === w.workspaceId && <Check className="size-4 text-primary" />}
                </button>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={!target || busy} onClick={() => void move()} data-jam-move="">
            {busy && <Spinner data-icon="inline-start" />}{t('jams.moveHere')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
