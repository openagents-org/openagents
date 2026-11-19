'use client';

import { Fragment, useState } from 'react';
import { ArrowRight, AtSign, BookOpen, Compass, Files, Lightbulb, Plus, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from '@/components/ui/item';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useFormatters, useT } from '@/lib/i18n';
import { knowledgeTitle } from '@/lib/knowledge-title';
import { KnowledgeEditor } from './knowledge-editor';
import { ArtifactVisibilityBadge } from '@/components/sharing/artifact-access-badge';

type Template = 'guide' | 'context' | 'decisions';
const starters = [{ key: 'guide', Icon: Compass }, { key: 'context', Icon: BookOpen }, { key: 'decisions', Icon: Lightbulb }] as const;

type Draft = { title: string; content: string };

/** The knowledge landing page: what the library is for, starters, recent entries, and how to cite one in chat. */
export function KnowledgeOverview() {
  const t = useT();
  const { timeAgo } = useFormatters();
  const { knowledge, sessions, setSelectedKnowledgeId, refreshKnowledge } = useWorkspace();
  const { openView, openMobileDetail } = useLayout();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft | undefined>();
  const start = (template?: Template) => {
    setDraft(template ? { title: t(`knowledge.library.${template}Title`), content: t(`knowledge.library.${template}Content`) } : undefined);
    setCreating(true);
  };
  const recent = [...knowledge].sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')).slice(0, 3);

  return <div className="h-full overflow-y-auto bg-background">
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-5 py-8 sm:px-8 sm:py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl"><h1>{t('knowledge.library.heading')}</h1></CardTitle>
          <CardDescription className="max-w-lg">{t('knowledge.library.intro')}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={() => start()}><Plus data-icon="inline-start" />{t('knowledge.library.create')}</Button>
        </CardFooter>
      </Card>

      <section aria-labelledby="knowledge-purpose" className="grid gap-5 sm:grid-cols-2">
        <div>
          <h2 id="knowledge-purpose" className="flex items-center gap-2 text-sm font-medium"><BookOpen className="size-4 text-muted-foreground" />{t('knowledge.library.knowledgeLabel')}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('knowledge.library.knowledgePurpose')}</p>
        </div>
        <div className="border-t pt-4 sm:border-t-0 sm:border-s sm:ps-5 sm:pt-0">
          <h2 className="flex items-center gap-2 text-sm font-medium"><Files className="size-4 text-muted-foreground" />{t('knowledge.library.filesLabel')}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('knowledge.library.filesPurpose')}</p>
          <Button variant="link" size="xs" className="mt-1 px-0 text-foreground" onClick={() => openView('files')}>
            {t('knowledge.library.openFiles')}<ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </section>

      <section aria-labelledby="knowledge-starters" className="flex flex-col gap-3">
        <h2 id="knowledge-starters" className="text-sm font-medium">{t('knowledge.library.starters')}</h2>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {starters.map(({ key, Icon }) => (
            <Item key={key} variant="outline" size="sm" asChild className="flex-nowrap items-start bg-card hover:bg-muted/50">
              <button type="button" onClick={() => start(key)}>
                <ItemMedia variant="icon" className="text-muted-foreground"><Icon /></ItemMedia>
                <ItemContent>
                  <ItemTitle>{t(`knowledge.library.${key}Title`)}</ItemTitle>
                  <ItemDescription className="line-clamp-none text-xs">{t(`knowledge.library.${key}Description`)}</ItemDescription>
                </ItemContent>
                <Plus className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </Item>
          ))}
        </div>
      </section>

      {recent.length > 0 && <Card size="sm" aria-labelledby="knowledge-recent" role="region">
        <CardHeader>
          <CardTitle id="knowledge-recent">{t('knowledge.library.recent')}</CardTitle>
          <CardAction><Badge variant="secondary">{t('knowledge.library.entryCount', { count: knowledge.length })}</Badge></CardAction>
        </CardHeader>
        <CardContent>
          {/* Rows are split by separators alone: drop the has-[size] group gap and the separator margin. */}
          <ItemGroup className="has-data-[size=sm]:gap-0">
            {recent.map((entry, index) => (
              <Fragment key={entry.id}>
                {index > 0 && <ItemSeparator className="my-0" />}
                <Item size="sm" asChild className="flex-nowrap hover:bg-muted/50">
                  <button type="button" onClick={() => { setSelectedKnowledgeId(entry.id); openMobileDetail(); }}>
                    <ItemMedia variant="icon" className="text-muted-foreground"><BookOpen /></ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="w-full"><span className="min-w-0 truncate">{knowledgeTitle(entry.title, sessions)}</span></ItemTitle>
                      <ItemDescription className="text-xs">{t('knowledge.updated', { time: timeAgo(entry.updatedAt || entry.createdAt) })}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <ArtifactVisibilityBadge kind="knowledge" visibility={entry.visibility} effectiveVisibility={entry.effectiveVisibility} />
                      <ArrowRight className="size-3.5 text-muted-foreground" />
                    </ItemActions>
                  </button>
                </Item>
              </Fragment>
            ))}
          </ItemGroup>
        </CardContent>
      </Card>}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AtSign className="size-4 text-muted-foreground" />{t('knowledge.library.useTitle')}</CardTitle>
          <CardDescription>{t('knowledge.library.useDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t('knowledge.library.exampleLabel')}</p>
          <div className="rounded-lg border bg-muted/50 px-3 py-2.5 text-sm leading-6">
            <Badge variant="secondary" className="font-mono">@knowledge:project-brief</Badge>{' '}{t('knowledge.library.example')}
          </div>
        </CardContent>
        <CardFooter className="items-start gap-2 text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />{t('knowledge.library.access')}
        </CardFooter>
      </Card>
    </div>
    <KnowledgeEditor open={creating} entry={null} draft={draft} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await refreshKnowledge(); }} />
  </div>;
}
