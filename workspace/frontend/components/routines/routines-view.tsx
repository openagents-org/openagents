'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, RefreshCw, Trash2, Plus } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { CreateRoutineDialog } from './create-routine-dialog';
import { useFormatters, useT } from '@/lib/i18n';
import { useRoutineFormat } from './use-routine-format';

export function RoutinesView() {
  const { routines, refreshRoutines, createRoutine, sessions, agents, setCurrentSessionId } = useWorkspace();
  const { setViewMode } = useLayout();
  const t = useT();
  const { timeAgo } = useFormatters();
  const { formatSchedule, timeUntil } = useRoutineFormat();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-violet-500" />
          <h2 className="text-sm font-semibold">{t('routines.title')}</h2>
          {activeRoutines.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('tasks.activeCount', { count: activeRoutines.length })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowCreateDialog(true)}
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
        {activeRoutines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <CalendarClock className="size-8 opacity-30" />
            <p className="text-sm">{t('routines.emptyTitle')}</p>
            <p className="text-xs opacity-60">{t('routines.emptyBody')}</p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {activeRoutines.map((routine) => {
              const agentName = routine.createdBy.replace('openagents:', '');
              const creator = agents.find((a) => a.agentName === agentName);
              const creatorLabel = creator ? agentLabel(creator) : agentName;
              const session = sessions.find((s) => s.sessionId === routine.channelName);
              const channelTitle = session?.title || routine.channelName;

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
                        <span className="text-sm font-medium truncate">{routine.name}</span>
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
                        <span>{t('routines.nextRun', { time: timeUntil(routine.nextFiresAt) })}</span>
                        {routine.lastFiredAt && (
                          <>
                            <span>·</span>
                            <span>{t('routines.lastFired', { time: timeAgo(routine.lastFiredAt) })}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCancel(routine.id); }}
                      className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                      title={t('routines.cancel')}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
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
