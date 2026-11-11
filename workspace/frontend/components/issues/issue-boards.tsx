'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link2, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { IssueBoard } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useConfirm, usePrompt } from '@/components/ui/dialogs-provider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { errorMessage } from './issue-ui';
import { issueBoardPath, requestedIssueBoard, withIssueBoard } from '@/lib/issue-board-link';
import { requestedResource } from '@/lib/resource-link';
import { shareOrigin } from '@/lib/share-origin';

export const TEAM_BOARD = 'team';
const storageKey = (workspaceId: string) => `oa:issue-board:${workspaceId}`;

/** The workspace's boards plus the selected one, remembered per workspace in this browser. */
export function useIssueBoards(workspaceId: string | undefined) {
  const [boards, setBoards] = useState<IssueBoard[]>([]);
  const [boardId, setBoardIdState] = useState<string>(() => {
    if (typeof window === 'undefined' || !workspaceId) return TEAM_BOARD;
    const requested = requestedIssueBoard(window.location.href);
    if (requested) return requested;
    try { return window.localStorage.getItem(storageKey(workspaceId)) || TEAM_BOARD; }
    catch { return TEAM_BOARD; }
  });
  const setBoardId = useCallback((id: string) => {
    setBoardIdState(id);
    window.history.replaceState(window.history.state, '', withIssueBoard(window.location.href, id));
    if (workspaceId) {
      try { window.localStorage.setItem(storageKey(workspaceId), id); } catch {}
    }
  }, [workspaceId]);
  useEffect(() => {
    if (!workspaceId) return;
    try { window.localStorage.setItem(storageKey(workspaceId), boardId); } catch {}
    if (requestedResource(window.location.href)?.view === 'issues') {
      window.history.replaceState(window.history.state, '', withIssueBoard(window.location.href, boardId));
    }
  }, [boardId, workspaceId]);
  useEffect(() => {
    const onNavigate = () => setBoardIdState(requestedIssueBoard(window.location.href) || TEAM_BOARD);
    window.addEventListener('popstate', onNavigate);
    window.addEventListener('hashchange', onNavigate);
    return () => {
      window.removeEventListener('popstate', onNavigate);
      window.removeEventListener('hashchange', onNavigate);
    };
  }, []);
  const reloadBoards = useCallback(async () => {
    try {
      const next = await workspaceApi.listIssueBoards();
      setBoards(next);
      // A board deleted elsewhere falls back to Team issues.
      setBoardIdState((current) => (next.some((b) => b.id === current) ? current : TEAM_BOARD));
    } catch {}
  }, []);
  useEffect(() => { void reloadBoards(); }, [reloadBoards, workspaceId]);
  return { boards, boardId, setBoardId, reloadBoards };
}

/** Board tabs above the issue filters: Team issues first, then boards people added, then New board. */
export function IssueBoardTabs({ boards, boardId, workspaceId, onSelect, onChanged }: {
  boards: IssueBoard[];
  boardId: string;
  workspaceId: string;
  onSelect: (id: string) => void;
  onChanged: (selectId?: string) => void;
}) {
  const t = useT();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const copyLink = async (id: string) => {
    try {
      await navigator.clipboard.writeText(new URL(issueBoardPath(workspaceId, id), shareOrigin()).toString());
      toast.success(t('issues.boardLinkCopied'));
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const shown = boards.length ? boards : [{ id: TEAM_BOARD, name: t('issues.teamBoard'), default: true, active_count: 0, can_manage: false }];
  const nameTaken = (name: string, except?: string) => {
    const key = name.trim().replace(/\s+/g, ' ').toLowerCase();
    return key === 'team issues' || shown.some((b) => b.id !== except && !b.default && b.name.toLowerCase() === key);
  };

  const create = async () => {
    const name = (await prompt({
      title: t('issues.newBoardTitle'),
      description: t('issues.newBoardDescription'),
      placeholder: t('issues.boardNamePlaceholder'),
      confirmText: t('issues.createBoard'),
      validate: (value) => (value.trim() && nameTaken(value) ? t('issues.boardNameTaken') : null),
    }))?.trim();
    if (!name) return;
    try {
      const board = await workspaceApi.createIssueBoard(name);
      onChanged(board.id);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const rename = async (board: IssueBoard) => {
    const name = (await prompt({
      title: t('issues.renameBoardTitle'),
      defaultValue: board.name,
      placeholder: t('issues.boardNamePlaceholder'),
      confirmText: t('common.rename'),
      validate: (value) => (value.trim() && nameTaken(value, board.id) ? t('issues.boardNameTaken') : null),
    }))?.trim();
    if (!name || name === board.name) return;
    try {
      await workspaceApi.renameIssueBoard(board.id, name);
      onChanged();
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const remove = async (board: IssueBoard) => {
    const ok = await confirm({
      title: t('issues.deleteBoardTitle', { name: board.name }),
      description: t('issues.deleteBoardDescription'),
      confirmText: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      const { moved_issues } = await workspaceApi.deleteIssueBoard(board.id);
      if (moved_issues) toast.success(t('issues.boardDeletedMoved', { count: moved_issues }));
      onChanged(TEAM_BOARD);
    } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2" role="tablist" aria-label={t('issues.boards')}>
      {shown.map((board) => {
        const selected = board.id === boardId;
        return (
          <div key={board.id} className={cn('flex shrink-0 items-center rounded-md', selected && 'bg-muted')}>
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(board.id)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {board.default ? t('issues.teamBoard') : board.name}
              {board.active_count > 0 && <span className="tabular-nums text-muted-foreground">{board.active_count}</span>}
            </button>
            {selected && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label={t('issues.boardActions', { name: board.name })} className="mr-1 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground">
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuItem onClick={() => void copyLink(board.id)}><Link2 className="size-4" /><span>{t('issues.copyBoardLink')}</span></DropdownMenuItem>
                  {board.can_manage && <>
                    <DropdownMenuItem onClick={() => void rename(board)}><Pencil className="size-4" /><span>{t('issues.renameBoard')}</span></DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void remove(board)}><Trash2 className="size-4" /><span>{t('issues.deleteBoard')}</span></DropdownMenuItem>
                  </>}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      })}
      <button type="button" onClick={() => void create()} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground">
        <Plus className="size-3.5" />{t('issues.newBoard')}
      </button>
    </div>
  );
}
