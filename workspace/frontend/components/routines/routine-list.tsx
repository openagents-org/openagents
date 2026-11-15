'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Pause, Pencil, Play, RefreshCw, Trash2, Plus } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { ListToggleButton } from '@/components/layout/list-collapse-button';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { RoutineDialog } from './routine-dialog';
import { FeatureTourBanner } from '@/components/tours/feature-tour-banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import type { RoutineItem } from '@/lib/types';
import { useRoutineFormat } from './use-routine-format';
import { routineErrorMessage } from './routine-error';

export function RoutineList() {
  const { routines, refreshRoutines, createRoutine, updateRoutine, currentSessionId, setCurrentSessionId, agents } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();
  const t = useT();
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

  // Auto-select the first routine when entering the routines view
  useEffect(() => {
    if (visibleRoutines.length > 0 && (!currentSessionId || !currentSessionId.startsWith('routine'))) {
      setCurrentSessionId(visibleRoutines[0].channelName);
    }
  }, [visibleRoutines, currentSessionId, setCurrentSessionId]);

  const handleSelect = (channelName: string) => {
    setCurrentSessionId(channelName);
    if (isMobile) openMobileDetail();
  };

  const handleCancel = async (routineId: string) => {
    try {
      await workspaceApi.cancelRoutine(routineId);
      await refreshRoutines();
    } catch (err) {
      console.error('Failed to delete routine', err);
      toast.error(routineErrorMessage(err, t('routines.cancelFailed')));
    }
  };

  const handleTogglePause = async (routine: RoutineItem) => {
    const resuming = routine.status === 'paused';
    try {
      await updateRoutine(routine.id, { status: resuming ? 'active' : 'paused' });
    } catch (err) {
      console.error('Failed to update routine status', err);
      toast.error(routineErrorMessage(err, t(resuming ? 'routines.resumeFailed' : 'routines.pauseFailed')));
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
    <div className="flex h-full flex-col">
      {/* ── Header ── */}
      <div className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <ListToggleButton className="-ml-1 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm leading-relaxed font-semibold">{t('routines.title')}</span>
          {visibleRoutines.length > 0 && (
            <Badge variant="secondary">
              {visibleRoutines.length}
            </Badge>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button size="sm" className="me-1 shrink-0" onClick={openCreateDialog}>
            <Plus data-icon="inline-start" />
            {t('routines.createShort')}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('routines.refresh')}
                onClick={refreshRoutines}
                className="text-muted-foreground"
              >
                <RefreshCw />
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
        {visibleRoutines.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarClock />
              </EmptyMedia>
              <EmptyTitle>{t('routines.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('routines.emptyHint')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={openCreateDialog}>
                <Plus data-icon="inline-start" />
                {t('routines.createShort')}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div role="list" className="py-1">
            {visibleRoutines.map((routine) => {
              const agentName = routine.createdBy.replace('openagents:', '');
              const isSelected = currentSessionId === routine.channelName;
              const isPaused = routine.status === 'paused';

              return (
                <div
                  key={routine.id}
                  role="listitem"
                  className={cn(
                    'group flex items-start gap-1 border-b border-border/50 pe-2 transition-colors',
                    isSelected ? 'bg-muted' : 'hover:bg-muted',
                  )}
                >
                  <button
                    type="button"
                    aria-current={isSelected || undefined}
                    className="flex min-w-0 flex-1 items-start gap-2.5 py-2.5 ps-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => handleSelect(routine.channelName)}
                  >
                    <AgentAvatar name={agentName} size={20} className="mt-0.5 shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className={cn('truncate text-sm font-medium', isPaused && 'text-muted-foreground')}>
                        {routine.name}
                      </div>
                      <div className="text-xs text-muted-foreground">{formatSchedule(routine)}</div>
                      <div className="truncate text-xs text-muted-foreground">{routine.message}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground/70">
                        {isPaused
                          ? t('routines.paused')
                          : t('routines.nextRun', { time: timeUntil(routine.nextFiresAt) })}
                      </div>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 pt-2 text-muted-foreground">
                    {/* Edit stays visible: hidden behind hover, users never
                        found it and deleted + recreated routines instead. */}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => openEditDialog(routine)}
                      title={t('routines.edit')}
                      aria-label={t('routines.edit')}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleTogglePause(routine)}
                      className="md:hidden md:group-focus-within:inline-flex md:group-hover:inline-flex"
                      title={t(isPaused ? 'routines.resume' : 'routines.pause')}
                      aria-label={t(isPaused ? 'routines.resume' : 'routines.pause')}
                    >
                      {isPaused ? <Play /> : <Pause />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleCancel(routine.id)}
                      className="hover:bg-destructive/10 hover:text-destructive md:hidden md:group-focus-within:inline-flex md:group-hover:inline-flex"
                      title={t('routines.cancel')}
                      aria-label={t('routines.cancel')}
                    >
                      <Trash2 />
                    </Button>
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
