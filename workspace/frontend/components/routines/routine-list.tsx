'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, RefreshCw, Trash2, Plus } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { CreateRoutineDialog } from './create-routine-dialog';
import { FeatureTourBanner } from '@/components/tours/feature-tours';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useRoutineFormat } from './use-routine-format';

export function RoutineList() {
  const { routines, refreshRoutines, createRoutine, currentSessionId, setCurrentSessionId, agents } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();
  const t = useT();
  const { formatSchedule, timeUntil } = useRoutineFormat();
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
      {/* ── Header ── */}
      <div className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm leading-relaxed font-semibold">{t('routines.title')}</span>
          {activeRoutines.length > 0 && (
            <Badge variant="secondary" size="sm" className="rounded-full!">
              {activeRoutines.length}
            </Badge>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                aria-label={t('routines.createShort')}
                onClick={() => setShowCreateDialog(true)}
                className="text-muted-foreground"
              >
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('routines.createShort')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                aria-label={t('routines.refresh')}
                onClick={refreshRoutines}
                className="text-muted-foreground"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.refresh')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Narrow rail — the tour banner uses its stacked variant */}
      <FeatureTourBanner feature="routines" compact />

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {activeRoutines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <CalendarClock className="size-8 opacity-30" />
            <p className="text-sm">{t('routines.emptyTitle')}</p>
            <p className="text-xs opacity-60">{t('routines.emptyHint')}</p>
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
                      {t('routines.nextRun', { time: timeUntil(routine.nextFiresAt) })}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCancel(routine.id); }}
                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition-colors shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                    title={t('routines.cancel')}
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
