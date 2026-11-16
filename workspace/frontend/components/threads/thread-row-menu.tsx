'use client';

import { toast } from 'sonner';
import { Archive, ArchiveRestore, GitFork, Hash, MessageSquare, MoreVertical, Pencil, Pin, PinOff, Star, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';
import type { WorkspaceSession } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirm, usePrompt } from '@/components/ui/dialogs-provider';

/** The ⋮ menu on a thread row: rename, fork, channel/pin/star/archive, delete. */
export function ThreadRowMenu({ session }: { session: WorkspaceSession }) {
  const { updateSession, renameSession, forkSession } = useWorkspace();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const t = useT();

  const rename = async () => {
    const next = await prompt({
      title: t('threads.renameTitle'),
      placeholder: t('threads.renamePlaceholder'),
      defaultValue: session.title || '',
      confirmText: t('common.rename'),
    });
    const trimmed = next?.trim();
    if (trimmed && trimmed !== session.title) renameSession(session.sessionId, trimmed);
  };

  const fork = async () => {
    const title = (await prompt({
      title: t('threads.forkTitle'),
      description: t('threads.forkDescription'),
      placeholder: t('threads.renamePlaceholder'),
      defaultValue: `${session.title || t('threads.untitled')} (fork)`,
      confirmText: t('threads.fork'),
    }))?.trim();
    if (!title) return;
    try {
      await forkSession(session.sessionId, title);
    } catch {
      toast.error(t('chat.forkThreadFailed'));
    }
  };

  // Deleted threads are filtered out of the list with no way back, so confirm first.
  const remove = async () => {
    const ok = await confirm({
      title: t('threads.deleteTitle'),
      description: t('threads.deleteDescription', { title: session.title || t('threads.untitled') }),
      confirmText: t('common.delete'),
      destructive: true,
    });
    if (ok) updateSession(session.sessionId, { status: 'deleted' });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost" size="icon-sm"
          aria-label={t('threads.threadActions')}
          className="text-muted-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); void rename(); }}>
            <Pencil />
            <span>{t('common.rename')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); void fork(); }}>
            <GitFork />
            <span>{t('threads.forkMenu')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => {
            e.stopPropagation();
            void updateSession(session.sessionId, { isChannel: !session.isChannel })
              .catch(() => toast.error(t('threads.channelLabelFailed')));
          }}>
            {session.isChannel ? <MessageSquare /> : <Hash />}
            <span>{t(session.isChannel ? 'threads.convertToThread' : 'threads.markAsChannel')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => {
            e.stopPropagation();
            void updateSession(session.sessionId, { pinned: !session.pinned }).catch(() => toast.error(t('threads.pinFailed')));
          }}>
            {session.pinned ? <PinOff /> : <Pin />}
            <span>{t(session.pinned ? 'threads.unpin' : 'threads.pin')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => {
            e.stopPropagation();
            updateSession(session.sessionId, { starred: !session.starred });
          }}>
            <Star className={cn(session.starred && 'fill-warning text-warning')} />
            <span>{session.starred ? t('threads.unstar') : t('threads.star')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => {
            e.stopPropagation();
            updateSession(session.sessionId, { status: session.status === 'archived' ? 'active' : 'archived' });
          }}>
            {session.status === 'archived'
              ? <><ArchiveRestore /><span>{t('threads.unarchive')}</span></>
              : <><Archive /><span>{t('threads.archive')}</span></>}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); void remove(); }}>
            <Trash2 />
            <span>{t('common.delete')}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
