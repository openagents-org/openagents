'use client';

import { KanbanSquare, LayoutList, Search } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { IssueStatus } from '@/lib/types';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { IssueAssigneeFilter } from './issue-assignee-filter';
import { statuses, statusKeys } from './issue-ui';

export type IssueStatusFilter = IssueStatus | 'all' | 'mine';
export type IssueViewMode = 'list' | 'board';

interface IssuesToolbarProps {
  status: IssueStatusFilter;
  onStatus: (status: IssueStatusFilter) => void;
  assignee: string;
  onAssignee: (assignee: string) => void;
  query: string;
  onQuery: (query: string) => void;
  view: IssueViewMode;
  onView: (view: IssueViewMode) => void;
}

/** Status filter, assignee filter, search and the list/board switch. */
export function IssuesToolbar({ status, onStatus, assignee, onAssignee, query, onQuery, view, onView }: IssuesToolbarProps) {
  const t = useT();
  return <>
    <ToggleGroup
      type="single"
      size="sm"
      spacing={1}
      className="mb-3 overflow-x-auto"
      value={status}
      // Pressing the active filter again would clear it; keep one selected.
      onValueChange={(next) => { if (next) onStatus(next as IssueStatusFilter); }}
      aria-label={t('issues.status')}
    >
      {(['all', 'mine', ...statuses] as const).map((value) => (
        <ToggleGroupItem key={value} value={value} className="shrink-0 text-xs">
          {value === 'all' ? t('issues.activeIssues') : value === 'mine' ? t('issues.assignedToMe') : t(statusKeys[value])}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
    <div className="mb-3 ml-auto flex min-w-0 flex-1 items-center justify-end gap-3 sm:flex-none">
      <IssueAssigneeFilter value={assignee} onChange={onAssignee} />
      <InputGroup className="h-7 w-full sm:w-48">
        <InputGroupAddon>
          <Search className="size-3.5" />
        </InputGroupAddon>
        <InputGroupInput
          className="text-xs"
          aria-label={t('issues.search')}
          placeholder={t('issues.search')}
          value={query}
          maxLength={240}
          onChange={(e) => onQuery(e.target.value)}
        />
      </InputGroup>
      {/* Two pressed-state toggles rather than a radio group: choosing the
          current view again still closes the open issue. */}
      <div className="flex shrink-0 gap-0.5">
        <Toggle variant="outline" size="sm" pressed={view === 'list'} onPressedChange={() => onView('list')} aria-label={t('issues.list')}>
          <LayoutList />
        </Toggle>
        <Toggle variant="outline" size="sm" pressed={view === 'board'} onPressedChange={() => onView('board')} aria-label={t('issues.board')}>
          <KanbanSquare />
        </Toggle>
      </div>
    </div>
  </>;
}
