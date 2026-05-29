'use client';

import { CalendarClock } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoutineActionMetadata {
  actionType: 'routine_created';
  routine: {
    id: string;
    name: string;
    schedule: string; // e.g. "工作日 10:00"
    targetAgent?: string;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RoutineActionCard({ metadata }: { metadata: RoutineActionMetadata }) {
  const { routine } = metadata;

  return (
    <div className="rounded-lg border bg-muted/30 border-l-4 border-l-violet-500 max-w-sm p-3 space-y-1.5">
      {/* Header */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="size-3.5" />
        <span>定时任务已创建</span>
      </div>

      {/* Name */}
      <p className="text-sm font-medium text-foreground leading-snug">
        {routine.name}
      </p>

      {/* Details */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-500/15 text-violet-600 dark:text-violet-400">
          {routine.schedule}
        </span>
        {routine.targetAgent && (
          <span className="text-[10px] text-muted-foreground">
            → {routine.targetAgent}
          </span>
        )}
      </div>
    </div>
  );
}
