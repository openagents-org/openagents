'use client';

import { ArrowDownAZ, ArrowDownWideNarrow, Plus, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { ListToggleButton } from '@/components/layout/list-collapse-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SortOrder } from './thread-list-utils';

interface ThreadListHeaderProps {
  unreadCount: number;
  onNewThread: () => void;
  onRefresh: () => void;
  onSort: (order: SortOrder) => void;
}

export function ThreadListHeader({ unreadCount, onNewThread, onRefresh, onSort }: ThreadListHeaderProps) {
  const t = useT();
  return (
    <div className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b border-border px-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <ListToggleButton className="-ml-1 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm leading-relaxed font-semibold">{t('threads.title')}</span>
        {/* Unread threads, in the app-shell-4 outlined-count style. Hidden at
            zero — a "0" beside the title is noise, not information. */}
        {unreadCount > 0 && (
          <Badge variant="outline" aria-label={t('threads.unreadCount', { count: unreadCount })}>
            {unreadCount}
          </Badge>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button size="sm" className="mr-1 shrink-0" onClick={onNewThread}>
          <Plus data-icon="inline-start" />
          {t('threads.newThread')}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('threads.refresh')} onClick={onRefresh} className="text-muted-foreground">
              <RefreshCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.refresh')}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t('threads.sort')} className="text-muted-foreground">
                  <SlidersHorizontal />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('threads.sort')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('threads.sortBy')}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onSort('recent')}>
                <ArrowDownWideNarrow />
                {t('threads.sortRecent')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSort('oldest')}>
                <ArrowDownWideNarrow className="rotate-180" />
                {t('threads.sortOldest')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSort('title')}>
                <ArrowDownAZ />
                {t('threads.sortTitle')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

interface ThreadSearchProps {
  value: string;
  searching: boolean;
  onChange: (value: string) => void;
}

export function ThreadSearch({ value, searching, onChange }: ThreadSearchProps) {
  const t = useT();
  return (
    <div className="shrink-0 border-b border-border/60 px-3 py-2">
      <InputGroup className="h-7">
        <InputGroupAddon>
          <Search className="size-3" />
        </InputGroupAddon>
        <InputGroupInput
          placeholder={t('threads.searchPlaceholder')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={t('threads.searchLabel')}
          className="text-xs"
        />
        {(searching || value) && (
          <InputGroupAddon align="inline-end">
            {searching ? (
              <Spinner className="size-3" />
            ) : (
              <InputGroupButton size="icon-xs" onClick={() => onChange('')} aria-label={t('threads.clearSearch')}>
                <X />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        )}
      </InputGroup>
    </div>
  );
}
