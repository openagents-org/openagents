'use client';

import { useState } from 'react';
import { ArrowRight, AtSign, BookOpen, Compass, Files, Lightbulb, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useFormatters, useT } from '@/lib/i18n';
import { knowledgeTitle } from '@/lib/knowledge-title';
import { KnowledgeEditor } from './knowledge-editor';
import { ArtifactVisibilityBadge } from '@/components/sharing/artifact-access-badge';

type Template = 'guide' | 'context' | 'decisions';
const starters = [{ key: 'guide', Icon: Compass }, { key: 'context', Icon: BookOpen }, { key: 'decisions', Icon: Lightbulb }] as const;

type Draft = { title: string; content: string };

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
    <div className="mx-auto max-w-4xl space-y-9 px-5 py-8 sm:px-8 sm:py-10">
      <section className="relative overflow-hidden rounded-2xl border border-indigo-500/15 bg-gradient-to-br from-indigo-500/[0.07] via-background to-background p-6 sm:p-8">
        <BookOpen className="mb-5 size-8 text-indigo-600 dark:text-indigo-400" strokeWidth={1.5} />
        <p className="text-xs font-medium uppercase tracking-widest text-indigo-600 dark:text-indigo-400">{t('knowledge.library.eyebrow')}</p>
        <h1 className="mt-3 max-w-lg text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{t('knowledge.library.heading')}</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">{t('knowledge.library.intro')}</p>
        <Button className="mt-6" onClick={() => start()}><Plus data-icon="inline-start" />{t('knowledge.library.create')}</Button>
      </section>

      <section aria-labelledby="knowledge-purpose" className="grid gap-5 sm:grid-cols-2">
        <div>
          <h2 id="knowledge-purpose" className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="size-4 text-indigo-600 dark:text-indigo-400" />{t('knowledge.library.knowledgeLabel')}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('knowledge.library.knowledgePurpose')}</p>
        </div>
        <div className="border-t pt-4 sm:border-t-0 sm:border-s sm:ps-5 sm:pt-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Files className="size-4 text-muted-foreground" />{t('knowledge.library.filesLabel')}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('knowledge.library.filesPurpose')}</p>
          <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => openView('files')}>{t('knowledge.library.openFiles')}<ArrowRight className="size-3" /></button>
        </div>
      </section>

      <section aria-labelledby="knowledge-starters">
        <h2 id="knowledge-starters" className="text-sm font-semibold">{t('knowledge.library.starters')}</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {starters.map(({ key, Icon }) => <button key={key} type="button" onClick={() => start(key)} className="group rounded-xl border p-4 text-start transition-colors hover:border-indigo-500/30 hover:bg-indigo-500/[0.03] focus-visible:outline-2 focus-visible:outline-ring">
            <Icon className="mb-3 size-4 text-muted-foreground" />
            <span className="flex items-center justify-between gap-2 text-sm font-medium">{t(`knowledge.library.${key}Title`)}<Plus className="size-3.5 shrink-0 text-muted-foreground" /></span>
            <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">{t(`knowledge.library.${key}Description`)}</span>
          </button>)}
        </div>
      </section>

      {recent.length > 0 && <section aria-labelledby="knowledge-recent">
        <div className="mb-2 flex items-center justify-between gap-2"><h2 id="knowledge-recent" className="text-sm font-semibold">{t('knowledge.library.recent')}</h2><span className="text-xs text-muted-foreground">{t('knowledge.library.entryCount', { count: knowledge.length })}</span></div>
        <div className="divide-y">{recent.map(entry => <button key={entry.id} type="button" onClick={() => { setSelectedKnowledgeId(entry.id); openMobileDetail(); }} className="group flex w-full items-center gap-3 rounded-lg px-2 py-3.5 text-start hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
          <BookOpen className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{knowledgeTitle(entry.title, sessions)}</span><span className="mt-1 block text-xs text-muted-foreground">{t('knowledge.updated', { time: timeAgo(entry.updatedAt || entry.createdAt) })}</span></span>
          <ArtifactVisibilityBadge kind="knowledge" visibility={entry.visibility} effectiveVisibility={entry.effectiveVisibility} />
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
        </button>)}</div>
      </section>}

      <section className="rounded-xl border bg-muted/25 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><AtSign className="size-4" />{t('knowledge.library.useTitle')}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('knowledge.library.useDescription')}</p>
        <p className="mt-3 text-xs text-muted-foreground">{t('knowledge.library.exampleLabel')}</p>
        <div className="mt-1.5 rounded-lg border bg-background px-3 py-2.5 text-sm leading-6"><span className="rounded bg-indigo-500/10 px-1.5 py-0.5 font-medium text-indigo-700 dark:text-indigo-300">@knowledge:project-brief</span>{' '}{t('knowledge.library.example')}</div>
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />{t('knowledge.library.access')}</p>
      </section>
    </div>
    <KnowledgeEditor open={creating} entry={null} draft={draft} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await refreshKnowledge(); }} />
  </div>;
}
