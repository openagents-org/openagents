'use client';

// ── v1.1 M1 — thread privacy lock ────────────────────────────────────────────
// "Private · N people" vs "Workspace" for the open thread, toggled through
// PATCH visibility. The server decides who may flip it (participants, the
// director, admins); a 403 is explained in a toast rather than hidden.

import { useEffect, useState } from 'react';
import { ChevronDown, Globe, Lock } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { apiErrorStatus, displayNameFromEmail } from '@/lib/collab';
import { useT } from '@/lib/i18n';
import type { ChannelVisibility } from '@/lib/types';

/** DMs and routine runs have no ACL of their own — only real channels do. */
export function threadPrivacyApplies(channelName: string | null | undefined): boolean {
  if (!channelName) return false;
  return !channelName.startsWith('dm:') && !channelName.startsWith('routine:') && !channelName.startsWith('task:');
}

export function ThreadPrivacyControl({ channelName, className }: { channelName: string; className?: string }) {
  const { sessions, setSessionVisibility } = useWorkspace();
  const t = useT();
  const session = sessions.find((s) => s.sessionId === channelName);
  const hasSession = !!session;
  const visibility: ChannelVisibility = session?.visibility === 'private' ? 'private' : 'workspace';
  const directorEmail = session?.directorEmail || null;

  const [humanCount, setHumanCount] = useState<number | null>(null);
  const [directorName, setDirectorName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The people count only matters for a private thread; fetched when the
  // thread (or its visibility) changes, never on every discovery poll.
  useEffect(() => {
    if (!hasSession || visibility !== 'private') {
      setHumanCount(null);
      setDirectorName(null);
      return;
    }
    let cancelled = false;
    workspaceApi.getChannelParticipants(channelName)
      .then((p) => {
        if (cancelled) return;
        setHumanCount(p.humans.length);
        const director = p.director_email
          ? p.humans.find((h) => h.email.toLowerCase() === p.director_email!.toLowerCase())
          : undefined;
        setDirectorName(director?.display_name || null);
      })
      .catch(() => { /* count stays unknown; the label degrades to "Private" */ });
    return () => { cancelled = true; };
  }, [channelName, visibility, hasSession]);

  if (!hasSession || !threadPrivacyApplies(channelName)) return null;

  const isPrivate = visibility === 'private';
  const label = isPrivate
    ? (humanCount != null ? t('collab.privateWithCount', { count: humanCount }) : t('collab.privateThread'))
    : t('collab.workspaceThread');
  const director = directorEmail ? (directorName || displayNameFromEmail(directorEmail)) : null;

  const change = async (next: ChannelVisibility) => {
    if (next === visibility || busy) return;
    setBusy(true);
    try {
      await setSessionVisibility(channelName, next);
      toast.success(next === 'private' ? t('collab.visibilityPrivateNow') : t('collab.visibilityWorkspaceNow'));
    } catch (e) {
      toast.error(apiErrorStatus(e) === 403 ? t('collab.visibilityForbidden') : t('collab.visibilityFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={busy}
            title={isPrivate ? t('collab.privateThreadHint') : t('collab.workspaceThreadHint')}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 transition-colors',
              'hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-60',
              isPrivate && 'text-foreground/80',
            )}
          >
            {isPrivate ? <Lock className="size-3" /> : <Globe className="size-3" />}
            <span>{label}</span>
            <ChevronDown className="size-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuItem onClick={() => change('workspace')} className="items-start gap-2.5 py-2">
            <Globe className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <div className={cn('text-sm', !isPrivate && 'font-medium')}>{t('collab.workspaceThread')}</div>
              <div className="text-xs text-muted-foreground">{t('collab.workspaceThreadHint')}</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => change('private')} className="items-start gap-2.5 py-2">
            <Lock className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <div className={cn('text-sm', isPrivate && 'font-medium')}>{t('collab.privateThread')}</div>
              <div className="text-xs text-muted-foreground">{t('collab.privateThreadHint')}</div>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {director && (
        <span className="truncate">
          <span className="text-muted-foreground/30">·</span> {t('collab.directedBy', { name: director })}
        </span>
      )}
    </div>
  );
}
