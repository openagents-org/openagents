'use client';

import * as React from 'react';
import { Waypoints, Crown, Sparkles, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { WorkspaceSession, WorkspaceAgent } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';
import { useT, type MessageKey } from '@/lib/i18n';

type Mode = 'dynamic' | 'master' | 'workflow';

const SIMPLE_MODES: { value: Mode; labelKey: MessageKey; icon: React.ElementType; descriptionKey: MessageKey }[] = [
  { value: 'dynamic', labelKey: 'orchestration.dynamic', icon: Sparkles, descriptionKey: 'orchestration.dynamicHint' },
  { value: 'master', labelKey: 'orchestration.master', icon: Crown, descriptionKey: 'orchestration.masterHint' },
];

interface Props {
  session: WorkspaceSession;
  agents: WorkspaceAgent[];
  onChange: (updates: { mode?: Mode; workflowId?: string | null }) => void;
}

/**
 * Header control for how a multi-agent thread coordinates: the dynamic router,
 * a master/sub-agent star, or a structured **Workflow** template that drives
 * the thread step by step. Picking a workflow switches the thread into workflow
 * mode and starts a run.
 */
export function OrchestrationControl({ session, onChange }: Props) {
  const t = useT();
  const { workflows } = useWorkspace();
  const mode = (session.orchestrationMode || 'dynamic') as Mode;

  const activeWorkflow = mode === 'workflow'
    ? workflows.find((w) => w.id === session.workflowId)
    : undefined;

  const ActiveIcon = mode === 'workflow' ? Waypoints : mode === 'master' ? Crown : Sparkles;
  const activeLabel = mode === 'workflow'
    ? (activeWorkflow?.name || t('orchestration.workflow'))
    : t(mode === 'master' ? 'orchestration.master' : 'orchestration.dynamic');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs font-medium" title={t('orchestration.label')}>
          <ActiveIcon className="size-3.5" />
          <span className="hidden lg:inline max-w-32 truncate">{activeLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t('orchestration.label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {SIMPLE_MODES.map((m) => {
          const Icon = m.icon;
          const isActive = m.value === mode;
          return (
            <DropdownMenuItem
              key={m.value}
              onSelect={() => onChange({ mode: m.value })}
              className="flex items-start gap-2 py-2 cursor-pointer"
            >
              <Icon className="size-3.5 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{t(m.labelKey)}</span>
                  {isActive && <Check className="size-3 text-primary" />}
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">{t(m.descriptionKey)}</p>
              </div>
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5">
          <Waypoints className="size-3.5" />
          {t('orchestration.pickWorkflow')}
        </DropdownMenuLabel>
        {workflows.length === 0 ? (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground">{t('orchestration.noWorkflows')}</div>
        ) : (
          workflows.map((w) => {
            const isActive = mode === 'workflow' && session.workflowId === w.id;
            return (
              <DropdownMenuItem
                key={w.id}
                onSelect={() => onChange({ mode: 'workflow', workflowId: w.id })}
                className="flex items-center gap-2 py-1.5 cursor-pointer"
              >
                <span className="text-xs flex-1 truncate">{w.name}</span>
                {isActive && <Check className="size-3 text-primary" />}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
