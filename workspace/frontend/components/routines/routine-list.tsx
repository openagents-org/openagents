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
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { cn } from '@/lib/utils';
import { destructiveIconClass } from '@/lib/destructive-icon';
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
          <WithTooltip label={t('common.refresh')}><Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('routines.refresh')}
                onClick={refreshRoutines}
                className="text-muted-foreground"
              >
                <RefreshCw />
              </Button></WithTooltip>
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
          <ItemGroup className="gap-0 py-1">
            {visibleRoutines.map((routine) => {
              const agentName = routine.createdBy.replace('openagents:', '');
              const isSelected = currentSessionId === routine.channelName;
              const isPaused = routine.status === 'paused';
              const action = (label: string, icon: React.ReactNode, onClick: () => void, destructive = false) => (
                <WithTooltip label={label}><Button variant="ghost" size="icon-xs" className={cn(destructive && destructiveIconClass)} onClick={onClick} aria-label={label}>{icon}</Button></WithTooltip>
              );

              return (
                <Item
                  key={routine.id}
                  role="listitem"
                  size="sm"
                  className={cn(
                    'relative flex-nowrap items-start rounded-none border-0 border-b border-border/50 pe-2',
                    isSelected ? 'bg-muted' : 'hover:bg-muted',
                  )}
                >
                  <ItemMedia>
                    <AgentAvatar name={agentName} size={20} />
                  </ItemMedia>
                  <ItemContent className="min-w-0 gap-0.5">
                    {/* The title's button stretches over the row, so the
                        whole row selects the routine; the actions sit above it. */}
                    <ItemTitle className={cn('w-full', isPaused && 'text-muted-foreground')}>
                      <button
                        type="button"
                        aria-current={isSelected || undefined}
                        className="truncate text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
                        onClick={() => handleSelect(routine.channelName)}
                      >
                        {routine.name}
                      </button>
                    </ItemTitle>
                    <ItemDescription className="line-clamp-1 text-xs">{formatSchedule(routine)}</ItemDescription>
                    <ItemDescription className="line-clamp-1 text-xs">{routine.message}</ItemDescription>
                    {isPaused
                      ? <Badge variant="secondary" className="mt-0.5">{t('routines.paused')}</Badge>
                      : <ItemDescription className="mt-0.5 text-xs text-muted-foreground/70">{t('routines.nextRun', { time: timeUntil(routine.nextFiresAt) })}</ItemDescription>}
                  </ItemContent>
                  {/* Every action stays visible: hidden behind hover, users
                      never found them, and touch screens have no hover. */}
                  <ItemActions className="relative z-10 gap-0.5 text-muted-foreground">
                    {action(t('routines.edit'), <Pencil />, () => openEditDialog(routine))}
                    {action(t(isPaused ? 'routines.resume' : 'routines.pause'), isPaused ? <Play /> : <Pause />, () => handleTogglePause(routine))}
                    {action(t('routines.cancel'), <Trash2 />, () => handleCancel(routine.id), true)}
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
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
