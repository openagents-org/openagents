'use client';

// ── v1.1 — thread access on the status bar ───────────────────────────────────
// "Private" / "Public" for the open thread, plus its owner. The
// owner (or an admin) may flip Private ↔ Public and switch "participants can
// add people"; everyone else just reads the state. A public thread the viewer
// has not joined shows a Join button (POST /channels/{name}/join). Legacy
// 'workspace' visibility reads as Public (permission-model-v1.md §2).

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Globe, Loader2, Lock, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { useMe } from '@/hooks/use-me';
import { useThreadAccess } from '@/hooks/use-thread-access';
import { THREAD_PARTICIPANTS_CHANGED } from '@/lib/thread-participants';
import { workspaceApi } from '@/lib/api';
import { apiErrorStatus, displayNameFromEmail } from '@/lib/collab';
import {
  canManageThread,
  normalizeThreadVisibility,
  showJoinButton,
  threadOwnerEmail,
  type ThreadVisibility,
} from '@/lib/access-ui';
import { useT } from '@/lib/i18n';
import type { ChannelParticipants } from '@/lib/types';

/** DMs and routine runs have no ACL of their own — only real channels do. */
export function threadPrivacyApplies(channelName: string | null | undefined): boolean {
  if (!channelName) return false;
  return !channelName.startsWith('dm:') && !channelName.startsWith('routine:') && !channelName.startsWith('task:');
}

export function ThreadPrivacyControl({ channelName, className, inDialog = false, joinOnly = false }: { channelName: string; className?: string; inDialog?: boolean; joinOnly?: boolean }) {
  const { sessions, setSessionVisibility, workspace, refreshAgents } = useWorkspace();
  const t = useT();
  const me = useMe(workspace?.slug || workspace?.workspaceId);
  const access = useThreadAccess(channelName);
  const session = sessions.find((s) => s.sessionId === channelName);
  const hasSession = !!session;
  const visibility: ThreadVisibility = normalizeThreadVisibility(session?.visibility);

  const [participants, setParticipants] = useState<ChannelParticipants | null>(null);
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);

  // Participants drive the owner's display name and the
  // "have I joined?" check; fetched when the thread or its visibility
  // changes, never on every discovery poll.
  const loadParticipants = useCallback(async () => {
    try {
      const p = await workspaceApi.getChannelParticipants(channelName);
      setParticipants(p);
    } catch {
      /* Keep the last known participant details when refreshing fails. */
    }
  }, [channelName]);

  useEffect(() => {
    setParticipants(null);
    if (!hasSession) return;
    let cancelled = false;
    workspaceApi.getChannelParticipants(channelName)
      .then((p) => {
        if (cancelled) return;
        setParticipants(p);
      })
      .catch(() => { /* see loadParticipants */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, visibility, hasSession]);

  if (!hasSession || !threadPrivacyApplies(channelName)) return null;

  const ownerEmail = (participants?.owner_email || '').toLowerCase() || threadOwnerEmail(session);
  const ownerRecord = ownerEmail ? participants?.humans.find((h) => h.email.toLowerCase() === ownerEmail) : undefined;
  const ownerName = ownerEmail ? (ownerRecord?.display_name || displayNameFromEmail(ownerEmail)) : null;
  const isOwner = !!me?.email && !!ownerEmail && me.email.toLowerCase() === ownerEmail;
  const manage = !!access?.can_manage;
  const isPrivate = visibility === 'private';
  const label = isPrivate
    ? t('threadAccess.private')
    : t('threadAccess.public');
  const canJoin = showJoinButton(visibility, participants?.humans, me?.email);

  const change = async (next: ThreadVisibility) => {
    if (!manage || next === visibility || busy) return;
    setBusy(true);
    try {
      await setSessionVisibility(channelName, next);
      toast.success(next === 'private' ? t('threadAccess.nowPrivate') : t('threadAccess.nowPublic'));
    } catch (e) {
      toast.error(apiErrorStatus(e) === 403 ? t('threadAccess.changeForbidden') : t('threadAccess.changeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (joining) return;
    setJoining(true);
    try {
      await workspaceApi.joinChannel(channelName);
      toast.success(t('threadAccess.joined'));
      await loadParticipants();
      window.dispatchEvent(new CustomEvent(THREAD_PARTICIPANTS_CHANGED, { detail: channelName }));
      refreshAgents().catch(() => {});
    } catch {
      toast.error(t('threadAccess.joinFailed'));
    } finally {
      setJoining(false);
    }
  };

  const trigger = (
    <button
      type="button"
      disabled={busy || !manage}
      title={isPrivate ? t('threadAccess.privateHint') : t('threadAccess.publicHint')}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 transition-colors',
        manage && 'hover:bg-zinc-200 dark:hover:bg-zinc-700',
        'disabled:opacity-100 disabled:cursor-default',
        isPrivate && 'text-foreground/80',
      )}
    >
      {isPrivate ? <Lock className="size-3" /> : <Globe className="size-3" />}
      <span>{label}</span>
      {manage && (busy ? <Loader2 className="size-3 animate-spin opacity-60" /> : <ChevronDown className="size-3 opacity-60" />)}
    </button>
  );

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground', className)}>
      {!joinOnly && (manage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className={inDialog ? "z-70 w-72" : "w-72"}>
            <DropdownMenuItem onClick={() => change('public')} disabled={!isPrivate} className="items-start gap-2.5 py-2">
              <Globe className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm">{isPrivate ? t('threadAccess.makePublic') : t('threadAccess.public')}</div>
                <div className="text-xs text-muted-foreground">{t('threadAccess.publicHint')}</div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => change('private')} disabled={isPrivate} className="items-start gap-2.5 py-2">
              <Lock className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm">{isPrivate ? t('threadAccess.private') : t('threadAccess.makePrivate')}</div>
                <div className="text-xs text-muted-foreground">{t('threadAccess.privateHint')}</div>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : trigger)}

      {!joinOnly && !inDialog && ownerName && (
        <span className="truncate" title={ownerEmail || undefined}>
          <span className="text-muted-foreground/30">·</span>{' '}
          {isOwner ? t('threadAccess.youOwn') : t('threadAccess.owner', { name: ownerName })}
        </span>
      )}

      {canJoin && (
        <button
          type="button"
          onClick={join}
          disabled={joining}
          title={t('threadAccess.notJoinedHint')}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          {joining ? <Loader2 className="size-3 animate-spin" /> : <LogIn className="size-3" />}
          {joining ? t('threadAccess.joining') : t('threadAccess.join')}
        </button>
      )}
    </div>
  );
}
