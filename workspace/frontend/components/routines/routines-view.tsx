'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Pause, Pencil, Play, RefreshCw, Trash2, Plus } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { RoutineDialog } from './routine-dialog';
import { useFormatters, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { RoutineItem } from '@/lib/types';
import { useRoutineFormat } from './use-routine-format';

export function RoutinesView() {
  const { routines, refreshRoutines, createRoutine, updateRoutine, sessions, agents, setCurrentSessionId } = useWorkspace();
  const { setViewMode } = useLayout();
  const t = useT();
  const { timeAgo } = useFormatters();
  const { formatSchedule, timeUntil } = useRoutineFormat();
  const [dialogOpen, setDialogOpen] = useState(false);
  // Kept after the dialog closes so the title doesn't flip to "create" while
  // it animates out; opening the create dialog clears it.
  const [editing, setEditing] = useState<RoutineItem | null>(null);

  useEffect(() => {
    refreshRoutines();
  }, [refreshRoutines]);

  // Paused routines stay in the list — hiding them would leave no way back.
  const visibleRoutines = useMemo(
    () => routines.filter((r) => r.status !== 'cancelled'),
    [routines],
  );
  // The header counts what is actually scheduled, so a paused routine doesn't
  // get advertised as active.
  const activeCount = useMemo(
    () => visibleRoutines.filter((r) => r.status === 'active').length,
    [visibleRoutines],
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

  const handleTogglePause = async (routine: RoutineItem) => {
    try {
      await updateRoutine(routine.id, { status: routine.status === 'paused' ? 'active' : 'paused' });
    } catch {
      // Ignore
    }
  };

  const openCreateDialog = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEditDialog = (routine: RoutineItem) => {
    setEditing(routine);
    setDialogOpen(true);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-violet-500" />
          <h2 className="text-sm font-semibold">{t('routines.title')}</h2>
          {activeCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('tasks.activeCount', { count: activeCount })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={openCreateDialog}
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
            title={t('routines.createShort')}
          >
            <Plus className="size-3.5" />
          </button>
          <button
            onClick={refreshRoutines}
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {visibleRoutines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <CalendarClock className="size-8 opacity-30" />
            <p className="text-sm">{t('routines.emptyTitle')}</p>
            <p className="text-xs opacity-60">{t('routines.emptyBody')}</p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {visibleRoutines.map((routine) => {
              const agentName = routine.createdBy.replace('openagents:', '');
              const creator = agents.find((a) => a.agentName === agentName);
              const creatorLabel = creator ? agentLabel(creator) : agentName;
              const session = sessions.find((s) => s.sessionId === routine.channelName);
              const channelTitle = session?.title || routine.channelName;
              const isPaused = routine.status === 'paused';

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
                        <span className={cn('text-sm font-medium truncate', isPaused && 'text-muted-foreground')}>
                          {routine.name}
                        </span>
                        {isPaused && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {t('routines.paused')}
                          </span>
                        )}
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
                        <span>{creatorLabel}</span>
                        <span>·</span>
                        <span className="truncate">{channelTitle}</span>
                        <span>·</span>
                        {!isPaused && (
                          <span>{t('routines.nextRun', { time: timeUntil(routine.nextFiresAt) })}</span>
                        )}
                        {routine.lastFiredAt && (
                          <>
                            <span>·</span>
                            <span>{t('routines.lastFired', { time: timeAgo(routine.lastFiredAt) })}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditDialog(routine); }}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title={t('routines.edit')}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleTogglePause(routine); }}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title={t(isPaused ? 'routines.resume' : 'routines.pause')}
                      >
                        {isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCancel(routine.id); }}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition-colors"
                        title={t('routines.cancel')}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <RoutineDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agents={agents}
        routine={editing}
        onCreateRoutine={createRoutine}
        onUpdateRoutine={updateRoutine}
      />
    </div>
  );
}
