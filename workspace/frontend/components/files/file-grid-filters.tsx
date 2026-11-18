'use client';

import { Search, X } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useT } from '@/lib/i18n';
import type { FileTypeFilter } from './file-utils';

export interface FileFilterCategory {
  id: FileTypeFilter;
  label: string;
  count: number;
}

/**
 * The strip under the header: what to narrow the folder to, by type, and the
 * folder's search box. Only categories with something behind them are offered,
 * plus "all" and whichever one is active.
 */
export function FileGridFilters({
  categories,
  typeFilter,
  onTypeFilter,
  search,
  onSearch,
}: {
  categories: FileFilterCategory[];
  typeFilter: FileTypeFilter;
  onTypeFilter: (filter: FileTypeFilter) => void;
  search: string;
  onSearch: (query: string) => void;
}) {
  const t = useT();
  const shown = categories.filter((c) => c.id === 'all' || c.count > 0 || c.id === typeFilter);

  return (
    <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-3 @3xl:flex-row @3xl:items-center">
      <InputGroup className="w-full @3xl:w-56 @3xl:shrink-0">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t('files.searchFilesPlaceholder')}
          aria-label={t('files.searchFilesLabel')}
          className="text-xs"
        />
        {search && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" onClick={() => onSearch('')} aria-label={t('files.clearSearch')}>
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      <div className="min-w-0 overflow-x-auto @3xl:ms-auto">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={1.5}
          value={typeFilter}
          // A single toggle group lets the active item be pressed off; that
          // would mean "no filter", which is what "all" already says.
          onValueChange={(v) => { if (v) onTypeFilter(v as FileTypeFilter); }}
          aria-label={t('files.filterByType')}
        >
          {shown.map((c) => (
            <ToggleGroupItem key={c.id} value={c.id} className="gap-2 text-xs">
              {c.label}
              <span className="tabular-nums text-muted-foreground">{c.count}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}
