'use client';

import { FileCode2, FileText, Folder, Globe, Layers, Pin, Search } from 'lucide-react';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Item } from '@/components/ui/item';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useT } from '@/lib/i18n';
import { openArtifactPreview, sameArtifact, type ArtifactReference } from '@/lib/thread-artifacts';

export type ArtifactEntry = { ref: ArtifactReference; title: string; kind: 'document' | 'html' | 'browser' | 'project'; here: boolean; detail?: string };

const KINDS = ['project', 'document', 'html', 'browser'] as const;
const ICONS = { project: Folder, document: FileText, html: FileCode2, browser: Globe };

/** The artifact panel's browse view: search, Thread / Workspace scope and the grouped list. */
export function ArtifactBrowseList({ entries, pinned, query, onQueryChange, all, onAllChange }: {
  entries: ArtifactEntry[];
  pinned: ArtifactReference | null;
  query: string;
  onQueryChange: (query: string) => void;
  all: boolean;
  onAllChange: (all: boolean) => void;
}) {
  const t = useT();
  return <>
    <InputGroup className="mb-3">
      <InputGroupAddon><Search /></InputGroupAddon>
      <InputGroupInput value={query} onChange={event => onQueryChange(event.target.value)} placeholder={t('artifactPanel.search')} aria-label={t('artifactPanel.search')} />
    </InputGroup>
    <ToggleGroup type="single" variant="outline" size="sm" spacing={0} className="mb-4" value={all ? 'workspace' : 'thread'} onValueChange={value => { if (value) onAllChange(value === 'workspace'); }}>
      <ToggleGroupItem value="thread">{t('artifactPanel.thread')}</ToggleGroupItem>
      <ToggleGroupItem value="workspace">{t('artifactPanel.workspace')}</ToggleGroupItem>
    </ToggleGroup>
    {KINDS.map(kind => {
      const rows = entries.filter(entry => entry.kind === kind);
      if (!rows.length) return null;
      const Icon = ICONS[kind];
      return <section key={kind} className="mb-5">
        <h3 className="mb-2 text-sm font-medium">{t(`artifactPanel.${kind}`)}</h3>
        <div className="flex flex-col gap-1">
          {rows.map(entry => <Item key={`${entry.ref.kind}:${entry.ref.id}`} asChild size="sm" className="flex-nowrap items-start text-left hover:bg-muted/50">
            {/* Item parts render block elements; spans keep the button's content valid. */}
            <button type="button" onClick={() => openArtifactPreview(entry.ref)}>
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{entry.title}</span>
                {entry.detail && <span className="mt-1 block truncate text-xs text-muted-foreground">{entry.detail}</span>}
              </span>
              {sameArtifact(entry.ref, pinned) && <Pin className="mt-1 size-3.5 shrink-0 text-muted-foreground" />}
            </button>
          </Item>)}
        </div>
      </section>;
    })}
    {!entries.length && <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon"><Layers /></EmptyMedia>
        <EmptyDescription>{t('artifactPanel.empty')}</EmptyDescription>
      </EmptyHeader>
    </Empty>}
  </>;
}
