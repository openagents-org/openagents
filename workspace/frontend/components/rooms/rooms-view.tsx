'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Check, Copy, ExternalLink, FolderInput, LayoutGrid, LayoutList, Link2, LogIn, MoreHorizontal, RefreshCw, Settings2, Trash2, Users } from 'lucide-react';
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
  deleteRoom,
  importShare,
  keepAsWorkspace,
  listMyRooms,
  listMyWorkspaces,
  roomGuestLinksClient,
  threadPath,
  type MyRoom,
  type MyWorkspace,
  type RoomCredentials,
} from '@/lib/share-room-api';
import { cn } from '@/lib/utils';

function defaultNavigate(href: string) {
  window.location.assign(href);
}

/** The copyable one-liner that makes a room from a coding agent's session. */
export function shareInstruction(t: ReturnType<typeof useT>, apiBase = getApiBaseUrl()): string {
  return t('rooms.instruction', { url: `${apiBase.replace(/\/+$/, '')}/v1/share/instructions` });
}

/**
 * "My rooms": every room the signed-in person owns — the conversation, its
 * agent and its guest link — with open, share, link settings, keep as a
 * workspace, add to a workspace and delete. Rooms kept as workspaces sit in
 * their own short section.
 */
export function RoomsView({ navigate = defaultNavigate }: { navigate?: (href: string) => void }) {
  const t = useT();
  const { user, idToken, loading, signIn } = useOpenAgentsAuth();
  const [rooms, setRooms] = useState<MyRoom[] | null>(null);
  const [failed, setFailed] = useState(false);
  const idTokenRef = useRef(idToken);
  idTokenRef.current = idToken;
  const signedIn = !!user && !!idToken;

  const load = useCallback(async () => {
    const token = idTokenRef.current;
    if (!token) return;
    setFailed(false);
    try {
      setRooms(await listMyRooms(token));
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { if (signedIn) void load(); }, [signedIn, load]);

  const creds = useCallback((room: MyRoom): RoomCredentials => ({ slug: room.workspace.slug, idToken: () => idTokenRef.current }), []);
  const active = useMemo(() => (rooms || []).filter((r) => !r.keptAsWorkspace), [rooms]);
  const kept = useMemo(() => (rooms || []).filter((r) => r.keptAsWorkspace), [rooms]);

  let body: React.ReactNode;
  if (loading) {
    body = <RoomsSkeleton />;
  } else if (!signedIn) {
    body = (
      <Empty className="py-16" data-rooms-state="sign-in">
        <EmptyHeader>
          <EmptyMedia variant="icon"><LayoutList /></EmptyMedia>
          <EmptyTitle>{t('rooms.signInTitle')}</EmptyTitle>
          <EmptyDescription>{t('rooms.signInBody')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => goToCentralLogin(() => { void signIn(); })} data-rooms-sign-in=""><LogIn data-icon="inline-start" />{t('rooms.signIn')}</Button>
        </EmptyContent>
      </Empty>
    );
  } else if (failed) {
    body = (
      <Empty className="py-16" data-rooms-state="error">
        <EmptyHeader><EmptyTitle>{t('rooms.loadFailed')}</EmptyTitle></EmptyHeader>
        <EmptyContent><Button variant="outline" onClick={() => void load()}><RefreshCw data-icon="inline-start" />{t('rooms.retry')}</Button></EmptyContent>
      </Empty>
    );
  } else if (!rooms) {
    body = <RoomsSkeleton />;
  } else if (rooms.length === 0) {
    body = <RoomsEmpty />;
  } else {
    body = (
      <div className="flex flex-col gap-8">
        {active.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label={t('rooms.title')} data-rooms-list="">
            {active.map((room) => (
              <RoomRow key={room.workspace.slug} room={room} creds={creds(room)} navigate={navigate}
                onChanged={() => void load()} onDeleted={() => setRooms((prev) => (prev || []).filter((r) => r.workspace.slug !== room.workspace.slug))} />
            ))}
          </ul>
        )}
        {active.length === 0 && <RoomsEmpty />}
        {kept.length > 0 && (
          <section className="flex flex-col gap-2" aria-label={t('rooms.keptHeading')} data-rooms-kept="">
            <div>
              <h2 className="text-sm font-medium">{t('rooms.keptHeading')}</h2>
              <p className="text-xs text-muted-foreground">{t('rooms.keptBody')}</p>
            </div>
            <ul className="flex flex-col gap-2">
              {kept.map((room) => (
                <li key={room.workspace.slug} className="flex items-center gap-3 rounded-xl border bg-background px-4 py-3" data-room={room.workspace.slug}>
                  <LayoutGrid className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{room.thread.title || room.thread.name}</span>
                  <Button size="sm" variant="outline" asChild data-room-open-workspace="">
                    <a href={threadPath(room.workspace.slug, room.thread.name)}><ExternalLink data-icon="inline-start" />{t('rooms.openWorkspace')}</a>
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
          <h1 className="font-heading text-base font-medium">{t('rooms.title')}</h1>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 lg:px-8">
          <p className="mb-5 text-sm text-muted-foreground">{t('rooms.subtitle')}</p>
          {body}
        </main>
      </div>
    </div>
  );
}

function RoomsSkeleton() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-busy="true" data-rooms-state="loading">
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

function RoomsEmpty() {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const instruction = shareInstruction(t);
  return (
    <Empty className="rounded-xl border border-dashed py-12" data-rooms-state="empty">
      <EmptyHeader>
        <EmptyMedia variant="icon"><LayoutList /></EmptyMedia>
        <EmptyTitle>{t('rooms.emptyTitle')}</EmptyTitle>
        <EmptyDescription>{t('rooms.emptyBody')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="w-full max-w-xl">
        <div className="flex w-full items-start gap-2 rounded-lg border bg-muted/40 p-3 text-left">
          <code className="min-w-0 flex-1 break-words font-mono text-xs leading-5" data-rooms-instruction="">{instruction}</code>
          <Button size="xs" variant="outline" onClick={() => {
            void navigator.clipboard?.writeText(instruction).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
          }}>
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copied ? t('rooms.copied') : t('rooms.copyInstruction')}
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}

function linkStatus(room: MyRoom, t: ReturnType<typeof useT>, formatDateTime: (iso: string) => string): { text: string; live: boolean } {
  const link = room.liveLink;
  if (!link) return { text: t('rooms.linkOff'), live: false };
  return { text: link.expiresAt ? t('rooms.linkExpires', { date: formatDateTime(link.expiresAt) }) : t('rooms.linkLive'), live: true };
}

/** One room: what it is and how it's doing, Open, and the rest in a menu. */
function RoomRow({ room, creds, navigate, onChanged, onDeleted }: {
  room: MyRoom;
  creds: RoomCredentials;
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
  const title = room.thread.title || room.thread.name;
  const agent = room.agents[0] ?? null;
  const status = linkStatus(room, t, formatDateTime);
  const ownerHref = `/share/own/${encodeURIComponent(room.workspace.slug)}`;

  const copyLink = async () => {
    if (!room.liveLink) return;
    try {
      await navigator.clipboard.writeText(room.liveLink.url);
      toast.success(t('rooms.linkCopied'));
    } catch {
      toast.error(t('rooms.actionFailed'));
    }
  };
  const makeWorkspace = async () => {
    setBusy('workspace');
    try {
      const result = await keepAsWorkspace(creds);
      navigate(threadPath(result.workspace.slug || room.workspace.slug, result.channel.name || room.thread.name));
    } catch {
      toast.error(t('rooms.actionFailed'));
      setBusy(null);
    }
  };
  const remove = async () => {
    const ok = await confirm({ title: t('rooms.deleteTitle', { title }), description: t('rooms.deleteBody'), confirmText: t('rooms.deleteConfirm'), destructive: true });
    if (!ok) return;
    setBusy('delete');
    try {
      await deleteRoom(creds);
      toast.success(t('rooms.deleted'));
      onDeleted();
    } catch {
      toast.error(t('rooms.actionFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="group/room flex items-center gap-3 rounded-xl border bg-background p-3 transition-colors hover:bg-muted/30 sm:p-4" data-room={room.workspace.slug}>
      <a href={ownerHref} className="flex min-w-0 flex-1 items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md" data-room-open="">
        {agent
          ? <AgentAvatar name={agent.name} size={36} showStatus status={agent.online ? 'online' : 'offline'} />
          : <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted"><LayoutList className="size-4 text-muted-foreground" /></span>}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{title}</span>
            {room.pendingRequests > 0 && <Badge variant="warning" className="shrink-0" data-room-pending="">{t('rooms.pending', { count: room.pendingRequests })}</Badge>}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {agent && <span data-room-agent="">{agentDisplayName(agent)}</span>}
            <span>{room.lastActivityAt ? t('rooms.activity', { time: timeAgoShort(new Date(room.lastActivityAt).toISOString()) }) : t('rooms.noActivity')}</span>
            <span className="inline-flex items-center gap-1"><Users className="size-3" />{t('rooms.guests', { count: room.guestCount })}</span>
            <span className={cn('inline-flex items-center gap-1', status.live ? 'text-foreground/70' : 'text-muted-foreground/70')} data-room-link={status.live ? 'live' : 'off'}>
              <Link2 className="size-3" />{status.text}
            </span>
          </span>
        </span>
      </a>
      <Button size="sm" variant="outline" asChild className="hidden sm:inline-flex">
        <a href={ownerHref}>{t('rooms.open')}</a>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t('rooms.more', { title })} disabled={!!busy} data-room-menu="">
            {busy ? <Spinner /> : <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem disabled={!room.liveLink} onSelect={() => void copyLink()} data-room-action="copy"><Copy />{t('rooms.copyLink')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setLinkOpen(true)} data-room-action="settings"><Settings2 />{t('rooms.linkSettings')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void makeWorkspace()} data-room-action="workspace"><LayoutGrid />{t('rooms.makeWorkspace')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPickOpen(true)} data-room-action="import"><FolderInput />{t('rooms.addToWorkspace')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => void remove()} data-room-action="delete"><Trash2 />{t('rooms.delete')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {linkOpen && <RoomLinkDialog room={room} creds={creds} onClose={() => { setLinkOpen(false); onChanged(); }} />}
      {pickOpen && <AddToWorkspaceDialog room={room} creds={creds} navigate={navigate} onClose={() => setPickOpen(false)} />}
    </li>
  );
}

/** The guest-link panel for one room, with the owner's sign-in. */
function RoomLinkDialog({ room, creds, onClose }: { room: MyRoom; creds: RoomCredentials; onClose: () => void }) {
  const client = useMemo(() => roomGuestLinksClient(creds), [creds]);
  const links = useGuestLinks(room.thread.name, true, client);
  const agent = room.agents[0];
  return (
    <GuestLinkDialog open onOpenChange={(open) => { if (!open) onClose(); }} channel={room.thread.name}
      agentName={agent ? agentDisplayName(agent) : null} links={links.links} error={links.error} setLinks={links.setLinks} client={client} />
  );
}

/** Merge the room into one of the person's workspaces. */
function AddToWorkspaceDialog({ room, creds, navigate, onClose }: { room: MyRoom; creds: RoomCredentials; navigate: (href: string) => void; onClose: () => void }) {
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
        const others = list.filter((w) => w.slug !== room.workspace.slug && w.workspaceId !== room.workspace.id);
        setWorkspaces(others);
        if (others.length === 1) setTarget(others[0].workspaceId);
      })
      .catch(() => { if (active) { setWorkspaces([]); setError(t('rooms.actionFailed')); } });
    return () => { active = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const move = async () => {
    if (!target) return;
    setBusy(true); setError(null);
    try {
      const result = await importShare(creds, target, bearer());
      navigate(threadPath(result.workspace.slug, result.channel.name));
    } catch {
      setError(t('rooms.actionFailed'));
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-room-import-dialog="">
        <DialogHeader>
          <DialogTitle>{t('rooms.pickWorkspaceTitle')}</DialogTitle>
          <DialogDescription>{t('rooms.pickWorkspaceBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {!workspaces && <div className="flex justify-center py-4"><Spinner className="size-5 text-muted-foreground" /></div>}
          {workspaces && workspaces.length === 0 && !error && <p className="text-sm text-muted-foreground">{t('rooms.noWorkspaces')}</p>}
          {workspaces && workspaces.length > 0 && (
            <div role="radiogroup" aria-label={t('rooms.pickWorkspaceTitle')} className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {workspaces.map((w) => (
                <button key={w.workspaceId} type="button" role="radio" aria-checked={target === w.workspaceId} disabled={busy}
                  onClick={() => setTarget(w.workspaceId)} data-room-target={w.workspaceId}
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
          <Button disabled={!target || busy} onClick={() => void move()} data-room-move="">
            {busy && <Spinner data-icon="inline-start" />}{t('rooms.moveHere')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
