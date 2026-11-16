'use client';

import { ArrowRight, BookOpen, Copy, Pencil, Play, Trash2, User } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useFormatters, useT } from '@/lib/i18n';
import type { Workflow } from '@/lib/types';

export type WorkflowUsage = { total: number; running: number; blocked: number };

function StepPill({ step }: { step: Workflow['steps'][number] }) {
  const isAgent = step.assignee.kind === 'agent';
  return (
    <Badge variant="outline" className="font-normal">
      {isAgent && step.assignee.agent ? (
        <AgentAvatar name={step.assignee.agent} size={14} />
      ) : (
        <User className="text-muted-foreground" />
      )}
      <span className="max-w-28 truncate">{step.name}</span>
      {step.knowledge_id && <BookOpen className="text-muted-foreground" />}
      {step.gate && <span className="text-warning" title={step.gate.condition}>↺</span>}
    </Badge>
  );
}

/** One saved workflow: its steps in order, how much work runs through it, and its actions. */
export function WorkflowCard({
  workflow: wf,
  usage: u,
  onDuplicate,
  onEdit,
  onDelete,
  onRun,
}: {
  workflow: Workflow;
  usage?: WorkflowUsage;
  onDuplicate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
}) {
  const t = useT();
  const { timeAgo } = useFormatters();
  return (
    <Card size="sm" className="group">
      <CardHeader>
        <CardTitle className="min-w-0 break-words">{wf.name}</CardTitle>
        {wf.description && <CardDescription className="line-clamp-2">{wf.description}</CardDescription>}
        <CardAction className="flex items-center gap-0.5 text-muted-foreground transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <Button variant="ghost" size="icon-xs" onClick={onDuplicate} title={t('workflows.duplicate')} aria-label={t('workflows.duplicate')}>
            <Copy />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onEdit} title={t('common.edit')} aria-label={t('common.edit')}>
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDelete}
            title={t('workflows.deleteWorkflow')}
            aria-label={t('workflows.deleteWorkflow')}
            className="hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="mt-auto flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {wf.steps.map((step, i) => (
            <span key={step.id} className="inline-flex items-center gap-1">
              {i > 0 && <ArrowRight className="size-3 text-muted-foreground/40" />}
              <StepPill step={step} />
            </span>
          ))}
        </div>

        {/* Usage + freshness: how much work runs through this template. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{t('workflows.stepCount', { count: wf.steps.length })}</span>
          {u && u.total > 0 && <span>· {t('workflows.usedCount', { count: u.total })}</span>}
          {u && u.running > 0 && <span className="text-warning">· {t('workflows.runningCount', { count: u.running })}</span>}
          {u && u.blocked > 0 && <span className="text-destructive">· {t('workflows.blockedCount', { count: u.blocked })}</span>}
          {wf.updatedAt && <span>· {t('workflows.metaEdited', { time: timeAgo(wf.updatedAt) })}</span>}
        </div>
      </CardContent>

      <CardFooter>
        <Button size="sm" variant="outline" onClick={onRun} className="w-full">
          <Play data-icon="inline-start" />
          {t('workflows.newTask')}
        </Button>
      </CardFooter>
    </Card>
  );
}
