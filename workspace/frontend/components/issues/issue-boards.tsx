'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link2, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { IssueBoard } from '@/lib/types';
import { useConfirm, usePrompt } from '@/components/ui/dialogs-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenuGroup, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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

  const selectedBoard = shown.find((board) => board.id === boardId);
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      <Tabs value={boardId} onValueChange={onSelect} activationMode="manual" className="shrink-0">
        <TabsList variant="line" aria-label={t('issues.boards')}>
          {shown.map((board) => (
            <TabsTrigger key={board.id} value={board.id} className="text-xs">
              {board.default ? t('issues.teamBoard') : board.name}
              {board.active_count > 0 && <Badge variant="secondary" className="tabular-nums">{board.active_count}</Badge>}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {/* The current board's actions sit after the tab strip, not inside the
          tablist: arrow keys rove only between tabs, so a button in there was
          unreachable by keyboard. */}
      {selectedBoard && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={t('issues.boardActions', { name: selectedBoard.name })} className="text-muted-foreground">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => void copyLink(selectedBoard.id)}><Link2 /><span>{t('issues.copyBoardLink')}</span></DropdownMenuItem>
            {selectedBoard.can_manage && <DropdownMenuItem onClick={() => void rename(selectedBoard)}><Pencil /><span>{t('issues.renameBoard')}</span></DropdownMenuItem>}
          </DropdownMenuGroup>
          {selectedBoard.can_manage && <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={() => void remove(selectedBoard)}><Trash2 /><span>{t('issues.deleteBoard')}</span></DropdownMenuItem>
            </DropdownMenuGroup>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
      )}
      <Button variant="ghost" size="xs" onClick={() => void create()} className="shrink-0 text-muted-foreground">
        <Plus data-icon="inline-start" />{t('issues.newBoard')}
      </Button>
    </div>
  );
}
