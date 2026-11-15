'use client';

import { Waypoints } from 'lucide-react';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { useT } from '@/lib/i18n';
import type { TemplateStarter } from './workflow-templates';

/** No workflows yet: say what they are, and offer the starters as cards. */
export function WorkflowsEmpty({
  templates,
  onPick,
}: {
  templates: { key: string; loop: boolean; tpl: TemplateStarter }[];
  onPick: (tpl: TemplateStarter) => void;
}) {
  const t = useT();
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Waypoints />
        </EmptyMedia>
        <EmptyTitle>{t('workflows.emptyTitle')}</EmptyTitle>
        <EmptyDescription>{t('workflows.emptyBody')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-2xl gap-3">
        <p className="text-xs font-medium text-muted-foreground">{t('workflows.tpl.heading')}</p>
        <div className="grid w-full gap-2.5 sm:grid-cols-3">
          {templates.map(({ key, loop, tpl }) => (
            <Item key={key} variant="outline" size="sm" asChild className="items-start bg-card hover:bg-muted/50">
              <button type="button" onClick={() => onPick(tpl)}>
                <ItemContent className="gap-1">
                  <ItemTitle className="text-xs">
                    {tpl.name}
                    {loop && <span className="text-warning" title={t('workflows.gateEnable')}>↺</span>}
                  </ItemTitle>
                  <ItemDescription className="text-xs">{tpl.description}</ItemDescription>
                  <p className="text-left text-xs text-muted-foreground/70">{tpl.steps.map((s) => s.name).join(' → ')}</p>
                </ItemContent>
              </button>
            </Item>
          ))}
        </div>
      </EmptyContent>
    </Empty>
  );
}
