'use client';

import { useState } from 'react';
import { ArrowRight, ArrowRightLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceAgent } from '@/lib/types';
import type { HandoffRecord } from '@/lib/handoff';
import { useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MarkdownContent } from './markdown-content';

// ── v1.1 M6 — hand-off card ──────────────────────────────────────────────────
// Header "from → to", the request, collapsible Context / Output so far, and
// who owns the work next. Compact on purpose: it sits inline in the thread.

export function HandoffCard({ handoff, agents, agentNames, agentLabels }: {
  handoff: HandoffRecord;
  agents: WorkspaceAgent[];
  agentNames: string[];
  agentLabels: Record<string, string>;
}) {
  const t = useT();
  const label = (name: string) => {
    const a = agents.find((x) => x.agentName === name);
    return a ? agentLabel(a) : name;
  };
  return (
    <Card size="sm" className="max-w-2xl gap-2">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <ArrowRightLeft aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          {t('collab.handoff.title')}
        </CardTitle>
        <CardDescription className="flex min-w-0 items-center gap-1.5 text-xs">
          <AgentAvatar name={handoff.from} size={16} />
          <span className="truncate">{label(handoff.from)}</span>
          <ArrowRight aria-hidden="true" className="size-3 shrink-0" />
          <AgentAvatar name={handoff.to} size={16} />
          <span className="truncate">{label(handoff.to)}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('collab.handoff.request')}</p>
          <MarkdownContent content={handoff.request} agentNames={agentNames} agentLabels={agentLabels} />
        </div>
        {handoff.context && <HandoffSection title={t('collab.handoff.context')} body={handoff.context} />}
        {handoff.output && <HandoffSection title={t('collab.handoff.output')} body={handoff.output} />}
      </CardContent>
      <CardFooter className="gap-1.5 py-2 text-xs text-muted-foreground">
        <AgentAvatar name={handoff.nextOwner} size={14} />
        <span className="truncate">{t('collab.handoff.nextOwner', { owner: label(handoff.nextOwner) })}</span>
      </CardFooter>
    </Card>
  );
}

function HandoffSection({ title, body }: { title: string; body: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground">
          <ChevronRight data-icon="inline-start" aria-hidden="true" className={cn('transition-transform', open && 'rotate-90')} />
          {title}
          <span className="font-normal text-muted-foreground">· {open ? t('collab.handoff.hide') : t('collab.handoff.show')}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 text-sm whitespace-pre-wrap text-foreground/90">{body}</CollapsibleContent>
    </Collapsible>
  );
}
