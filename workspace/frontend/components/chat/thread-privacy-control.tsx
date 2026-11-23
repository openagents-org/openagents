'use client';

// ── v1.1 — thread access on the status bar ───────────────────────────────────
// "Private" / "Public" for the open thread, plus its owner. The
// owner (or an admin) may flip Private ↔ Public and switch "participants can
// add people"; everyone else just reads the state. A public thread the viewer
// has not joined shows a Join button (POST /channels/{name}/join). Legacy
// 'workspace' visibility reads as Public (permission-model-v1.md §2).

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Globe, Lock, LogIn } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import {
  DropdownMenuGroup, DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { useWorkspace } from '@/lib/workspace-context';
import { useMe } from '@/hooks/use-me';
import { useThreadAccess } from '@/hooks/use-thread-access';
import { THREAD_PARTICIPANTS_CHANGED } from '@/lib/thread-participants';
import { workspaceApi } from '@/lib/api';
import { loadChannelParticipants } from '@/lib/channel-participants-store';
import { apiErrorStatus, displayNameFromEmail } from '@/lib/collab';
import {
  canManageThread,
  normalizeThreadVisibility,
  showJoinButton,
  threadOwnerEmail,
  type ThreadVisibility,
} from '@/lib/access-ui';
import { useT } from '@/lib/i18n';

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

  // The shared roster (useThreadAccess) also drives the owner's display name
  // and the "have I joined?" check.
  const participants = access;
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);

  // Re-read it when the thread's visibility flips, not on every discovery poll.
  const seenVisibility = useRef<string | null>(null);
  useEffect(() => {
    const seen = `${channelName}|${visibility}`;
    if (hasSession && seenVisibility.current?.startsWith(`${channelName}|`) && seenVisibility.current !== seen) {
      loadChannelParticipants(channelName, { force: true }).catch(() => {});
    }
    seenVisibility.current = seen;
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
      // Re-reads the shared roster, so the Join button goes everywhere at once.
      window.dispatchEvent(new CustomEvent(THREAD_PARTICIPANTS_CHANGED, { detail: channelName }));
      refreshAgents().catch(() => {});
    } catch {
      toast.error(t('threadAccess.joinFailed'));
    } finally {
      setJoining(false);
    }
  };

  const hint = isPrivate ? t('threadAccess.privateHint') : t('threadAccess.publicHint');
  const icon = isPrivate ? <Lock data-icon="inline-start" /> : <Globe data-icon="inline-start" />;

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground', className)}>
      {!joinOnly && (manage ? (
        <DropdownMenu>
          <WithTooltip label={hint}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs" disabled={busy} className={cn('shrink-0 font-normal text-muted-foreground', isPrivate && 'text-foreground/80')}>
                {icon}
                {label}
                {busy ? <Spinner data-icon="inline-end" /> : <ChevronDown data-icon="inline-end" />}
              </Button>
            </DropdownMenuTrigger>
          </WithTooltip>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => change('public')} disabled={!isPrivate} className="items-start">
                <Globe className="mt-0.5" />
                <div className="flex min-w-0 flex-col">
                  <span>{isPrivate ? t('threadAccess.makePublic') : t('threadAccess.public')}</span>
                  <span className="text-xs text-muted-foreground">{t('threadAccess.publicHint')}</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => change('private')} disabled={isPrivate} className="items-start">
                <Lock className="mt-0.5" />
                <div className="flex min-w-0 flex-col">
                  <span>{isPrivate ? t('threadAccess.private') : t('threadAccess.makePrivate')}</span>
                  <span className="text-xs text-muted-foreground">{t('threadAccess.privateHint')}</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <WithTooltip label={hint}>
          <span className={cn('inline-flex shrink-0 items-center gap-1 px-1 [&_svg]:size-3', isPrivate && 'text-foreground/80')}>
            {icon}
            {label}
          </span>
        </WithTooltip>
      ))}

      {!joinOnly && !inDialog && ownerName && (
        <span className="truncate" title={ownerEmail || undefined}>
          <span className="text-muted-foreground/30">·</span>{' '}
          {isOwner ? t('threadAccess.youOwn') : t('threadAccess.owner', { name: ownerName })}
        </span>
      )}

      {canJoin && (
        <WithTooltip label={t('threadAccess.notJoinedHint')}>
          <Button
            variant="outline"
            size="xs"
            onClick={join}
            disabled={joining}
          >
            {joining ? <Spinner data-icon="inline-start" /> : <LogIn data-icon="inline-start" />}
            {joining ? t('threadAccess.joining') : t('threadAccess.join')}
          </Button>
        </WithTooltip>
      )}
    </div>
  );
}
