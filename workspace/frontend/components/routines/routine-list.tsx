'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, RefreshCw, Trash2, Plus } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { CreateRoutineDialog } from './create-routine-dialog';
import { cn } from '@/lib/utils';
import type { RoutineItem } from '@/lib/types';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatSchedule(r: RoutineItem): string {
  if (r.scheduleIntervalMinutes) {
    const mins = r.scheduleIntervalMinutes;
    if (mins >= 60) return `Every ${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
    return `Every ${mins}m`;
  }
  const time = `${String(r.scheduleHour).padStart(2, '0')}:${String(r.scheduleMinute).padStart(2, '0')} UTC`;
  if (!r.scheduleDays || r.scheduleDays.length === 7) return `Daily at ${time}`;
  if (r.scheduleDays.length === 5 && [0, 1, 2, 3, 4].every((d) => r.scheduleDays!.includes(d))) return `Weekdays at ${time}`;
  const dayLabels = r.scheduleDays.map((d) => DAY_NAMES[d] || `${d}`).join(', ');
  return `${dayLabels} at ${time}`;
}

function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) return 'overdue';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function RoutineList() {
  const { routines, refreshRoutines, createRoutine, currentSessionId, setCurrentSessionId, agents } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  useEffect(() => {
    refreshRoutines();
  }, [refreshRoutines]);

  const activeRoutines = useMemo(
    () => routines.filter((r) => r.status === 'active'),
    [routines],
  );

  // Auto-select the first routine when entering the routines view
  useEffect(() => {
    if (activeRoutines.length > 0 && (!currentSessionId || !currentSessionId.startsWith('routine'))) {
      setCurrentSessionId(activeRoutines[0].channelName);
    }
  }, [activeRoutines, currentSessionId, setCurrentSessionId]);

  const handleSelect = (channelName: string) => {
    setCurrentSessionId(channelName);
    if (isMobile) openMobileDetail();
  };

  const handleCancel = async (routineId: string) => {
    try {
      await workspaceApi.cancelRoutine(routineId);
      await refreshRoutines();
    } catch {
      // Ignore
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-3.5 text-violet-500" />
          <h2 className="text-sm font-semibold">Routines</h2>
          {activeRoutines.length > 0 && (
            <span className="text-xs text-muted-foreground">{activeRoutines.length}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowCreateDialog(true)}
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
            title="Create routine"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            onClick={refreshRoutines}
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {activeRoutines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <CalendarClock className="size-8 opacity-30" />
            <p className="text-sm">No routines yet</p>
            <p className="text-xs opacity-60">Click + to create one</p>
          </div>
        ) : (
          <div className="py-1">
            {activeRoutines.map((routine) => {
              const agentName = routine.createdBy.replace('openagents:', '');
              const isSelected = currentSessionId === routine.channelName;

              return (
                <button
                  key={routine.id}
                  className={cn(
                    'group w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors border-b border-border/50',
                    isSelected
                      ? 'bg-zinc-100 dark:bg-zinc-800'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  )}
                  onClick={() => handleSelect(routine.channelName)}
                >
                  <AgentAvatar name={agentName} size={20} className="mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{routine.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{formatSchedule(routine)}</div>
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">{routine.message}</div>
                    <div className="text-[10px] text-muted-foreground/60 mt-1">
                      next: {timeUntil(routine.nextFiresAt)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCancel(routine.id); }}
                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition-colors shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                    title="Cancel routine"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <CreateRoutineDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        agents={agents}
        onCreateRoutine={createRoutine}
      />
    </div>
  );
}
