'use client';

import { ChevronDown, Filter, Plus, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { ListToggleButton } from '@/components/layout/list-collapse-button';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TABS, type FilterTab, type SortOrder } from './thread-list-utils';
import { WithTooltip } from '@/components/ui/with-tooltip';

interface ThreadListHeaderProps {
  onNewThread: () => void;
  onRefresh: () => void;
  onSort: (order: SortOrder) => void;
  sortOrder: SortOrder;
}

export function ThreadListHeader({ onNewThread, onRefresh, onSort, sortOrder }: ThreadListHeaderProps) {
  const t = useT();
  return (
    <div className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b border-border px-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <ListToggleButton className="-ml-1 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm leading-relaxed font-semibold">{t('threads.title')}</span>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button size="sm" className="mr-1 shrink-0" onClick={onNewThread}>
          <Plus data-icon="inline-start" />
          {t('threads.newThread')}
        </Button>
        <DropdownMenu>
          <WithTooltip label={t('threadProjects.viewOptions')}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('threadProjects.viewOptions')} className="text-muted-foreground"><SlidersHorizontal /></Button>
            </DropdownMenuTrigger>
          </WithTooltip>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{t('threads.sortBy')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortOrder} onValueChange={value => onSort(value as SortOrder)}>
              <DropdownMenuRadioItem value="recent">{t('threads.sortRecent')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="oldest">{t('threads.sortOldest')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="title">{t('threads.sortTitle')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup><DropdownMenuItem onSelect={onRefresh}><RefreshCw />{t('threads.refresh')}</DropdownMenuItem></DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

interface ThreadSearchProps {
  value: string;
  inline?: boolean;
  searching: boolean;
  onChange: (value: string) => void;
}

export function ThreadSearch({ value, searching, onChange, inline = false }: ThreadSearchProps) {
  const t = useT();
  return (
    <div className={inline ? 'min-w-0 flex-1' : 'shrink-0 px-3 pt-2 pb-1'}>
      <InputGroup className="h-8 rounded-lg bg-muted/25 shadow-none">
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

/** Conversation type is a single labeled filter rather than another row of tabs. */
export function ThreadConversationFilter({ value, counts, onChange, disabled = false }: { value: FilterTab; counts: Record<FilterTab, number | undefined>; onChange: (value: FilterTab) => void; disabled?: boolean }) {
  const t = useT();
  const tab = TABS.find(tab => tab.id === value)!;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" className="max-w-[52%] gap-1.5 px-2 text-xs text-muted-foreground" disabled={disabled} aria-label={t('threadProjects.filter')}>
        <Filter className="size-3.5 shrink-0" /><span className="truncate">{value === 'all' ? t('threadProjects.allConversations') : t(tab.labelKey)}</span>
        <ChevronDown className="size-3 shrink-0" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuLabel>{t('threadProjects.show')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={next => onChange(next as FilterTab)}>
        {TABS.map(tab => <DropdownMenuRadioItem key={tab.id} value={tab.id}>{tab.id === 'all' ? t('threadProjects.allConversations') : t(tab.labelKey)}{!!counts[tab.id] && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{counts[tab.id]}</span>}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
