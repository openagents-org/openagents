'use client';

import { cn } from '@/lib/utils';
import {
  SOURCE_FILTER_OPTIONS,
  PRIORITY_FILTER_OPTIONS,
  type InboxSourceFilter,
  type InboxPriorityFilter,
} from '@/lib/api-inbox';

interface InboxFiltersProps {
  sourceFilter: InboxSourceFilter;
  priorityFilter: InboxPriorityFilter;
  onSourceFilterChange: (filter: InboxSourceFilter) => void;
  onPriorityFilterChange: (filter: InboxPriorityFilter) => void;
}

export function InboxFilters({
  sourceFilter,
  priorityFilter,
  onSourceFilterChange,
  onPriorityFilterChange,
}: InboxFiltersProps) {
  return (
    <div className="space-y-2">
      {/* Source type filter */}
      <div className="flex items-center gap-1 flex-wrap">
        {SOURCE_FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => onSourceFilterChange(option.value)}
            className={cn(
              'px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors',
              sourceFilter === option.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Priority filter */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-muted-foreground mr-1">Priority:</span>
        {PRIORITY_FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => onPriorityFilterChange(option.value)}
            className={cn(
              'px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors',
              priorityFilter === option.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
