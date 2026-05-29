'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, RefreshCw, Trash2, Plus, BookTemplate } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { CreateRoutineDialog } from './create-routine-dialog';
import { RoutineOutput } from './routine-output';
import { RoutineTemplates } from './routine-templates';
import { MOCK_ROUTINES_V2, ROUTINE_TYPE_ICONS, ROUTINE_TYPE_LABELS, type RoutineTemplate } from '@/lib/api-routines';
import type { RoutineItem } from '@/lib/types';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatSchedule(r: RoutineItem): string {
  if (r.scheduleIntervalMinutes) {
    const mins = r.scheduleIntervalMinutes;
    if (mins >= 60) return `Every ${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
    return `Every ${mins}m`;
  }
  const time = `${String(r.scheduleHour).padStart(2, '0')}:${String(r.scheduleMinute).padStart(2, '0')} UTC`;
  if (!r.scheduleDays || r.scheduleDays.length === 7) {
    return `Daily at ${time}`;
  }
  if (r.scheduleDays.length === 5 && [0, 1, 2, 3, 4].every((d) => r.scheduleDays!.includes(d))) {
    return `Weekdays at ${time}`;
  }
  if (r.scheduleDays.length === 2 && [5, 6].every((d) => r.scheduleDays!.includes(d))) {
    return `Weekends at ${time}`;
  }
  const dayLabels = r.scheduleDays.map((d) => DAY_NAMES[d] || `${d}`).join(', ');
  return `${dayLabels} at ${time}`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
  return `${days}d ${hours % 24}h`;
}

export function RoutinesView() {
  const { routines, refreshRoutines, createRoutine, sessions, agents, setCurrentSessionId } = useWorkspace();
  const { setViewMode } = useLayout();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templatePrefill, setTemplatePrefill] = useState<{ name: string; message: string; hour: number; minute: number; days: number[] } | null>(null);

  useEffect(() => {
    refreshRoutines();
  }, [refreshRoutines]);

  const activeRoutines = useMemo(
    () => routines.filter((r) => r.status === 'active'),
    [routines],
  );

  const handleOpenThread = (channelName: string) => {
    setCurrentSessionId(channelName);
    setViewMode('threads');
  };

  const handleCancel = async (routineId: string) => {
    try {
      await workspaceApi.cancelRoutine(routineId);
      await refreshRoutines();
    } catch {
      // Ignore
    }
  };

  const handleSelectTemplate = (template: RoutineTemplate) => {
    setShowTemplates(false);
    setTemplatePrefill({
      name: template.name,
      message: template.message,
      hour: template.scheduleHour,
      minute: template.scheduleMinute,
      days: template.scheduleDays,
    });
    setShowCreateDialog(true);
  };

  // Merge live routines with mock v2 routines for display
  // In production, these would come from the same source
  const mockRoutineMap = useMemo(() => {
    const map = new Map<string, (typeof MOCK_ROUTINES_V2)[0]>();
    for (const mr of MOCK_ROUTINES_V2) {
      map.set(mr.name, mr);
    }
    return map;
  }, []);

  return (
    <div className="h-full flex flex-col relative">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-violet-500" />
          <h2 className="text-sm font-semibold">Routines</h2>
          {activeRoutines.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {activeRoutines.length} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowTemplates(true)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
            title="Routine templates"
          >
            <BookTemplate className="size-3.5" />
          </button>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
            title="Create routine"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            onClick={refreshRoutines}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeRoutines.length === 0 ? (
          /* Show mock V2 routines as demo when no real routines exist */
          <div className="p-4 space-y-3">
            <div className="text-[11px] text-muted-foreground bg-muted/50 rounded-md px-3 py-2 mb-2">
              Sample routines — create your own or pick from templates above
            </div>
            {MOCK_ROUTINES_V2.filter((r) => r.status === 'active').map((routine) => {
              const agentName = routine.createdBy.replace('openagents:', '');
              const routineType = routine.routineType;
              const typeIcon = ROUTINE_TYPE_ICONS[routineType];
              const typeLabel = ROUTINE_TYPE_LABELS[routineType];

              return (
                <div
                  key={routine.id}
                  className="rounded-lg border border-border bg-card overflow-hidden opacity-80 hover:opacity-100 transition-opacity"
                >
                  <div className="px-3 py-2.5 flex items-start gap-2.5">
                    <AgentAvatar name={agentName} size={20} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm" title={typeLabel}>{typeIcon}</span>
                        <span className="text-sm font-medium truncate">{routine.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium shrink-0">
                          {typeLabel}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatSchedule(routine as unknown as RoutineItem)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {routine.message}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/70">
                        <span>{agentName}</span>
                        <span>·</span>
                        <span>next: {timeUntil(routine.nextFiresAt)}</span>
                        {routine.lastFiredAt && (
                          <>
                            <span>·</span>
                            <span>last: {timeAgo(routine.lastFiredAt)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <RoutineOutput
                    lastOutput={routine.lastOutput}
                    lastFiredAt={routine.lastFiredAt}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {activeRoutines.map((routine) => {
              const agentName = routine.createdBy.replace('openagents:', '');
              const session = sessions.find((s) => s.sessionId === routine.channelName);
              const channelTitle = session?.title || routine.channelName;
              // Try to match with mock v2 routine for type badge and lastOutput
              const mockV2 = mockRoutineMap.get(routine.name);
              const routineType = mockV2?.routineType || 'custom';
              const typeIcon = ROUTINE_TYPE_ICONS[routineType];
              const typeLabel = ROUTINE_TYPE_LABELS[routineType];

              return (
                <div
                  key={routine.id}
                  className="rounded-lg border border-border bg-card overflow-hidden cursor-pointer hover:border-primary/40 transition-colors"
                  onClick={() => handleOpenThread(routine.channelName)}
                >
                  {/* Routine header */}
                  <div className="px-3 py-2.5 flex items-start gap-2.5">
                    <AgentAvatar name={agentName} size={20} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm" title={typeLabel}>{typeIcon}</span>
                        <span className="text-sm font-medium truncate">{routine.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium shrink-0">
                          {typeLabel}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatSchedule(routine)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {routine.message}
                      </div>
                      {routine.context && (
                        <div className="text-[11px] text-muted-foreground/60 mt-1 line-clamp-2">
                          {routine.context}
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/70">
                        <span>{agentName}</span>
                        <span>·</span>
                        <span className="truncate">{channelTitle}</span>
                        <span>·</span>
                        <span>next: {timeUntil(routine.nextFiresAt)}</span>
                        {routine.lastFiredAt && (
                          <>
                            <span>·</span>
                            <span>last: {timeAgo(routine.lastFiredAt)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCancel(routine.id); }}
                      className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                      title="Cancel routine"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>

                  {/* Last Output preview */}
                  {mockV2 && (
                    <RoutineOutput
                      lastOutput={mockV2.lastOutput}
                      lastFiredAt={mockV2.lastFiredAt}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CreateRoutineDialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          setShowCreateDialog(open);
          if (!open) setTemplatePrefill(null);
        }}
        agents={agents}
        onCreateRoutine={createRoutine}
      />

      <RoutineTemplates
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onSelectTemplate={handleSelectTemplate}
      />
    </div>
  );
}
