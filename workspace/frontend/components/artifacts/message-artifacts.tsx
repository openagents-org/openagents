'use client';
import { FileCode2, FileText, Globe, PanelRight } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { artifactFromLink, openArtifactPreview } from '@/lib/thread-artifacts';

/** Give linked outputs the same preview affordance as uploaded attachments. */
export function MessageArtifacts({ content, attachedIds }: { content: string; attachedIds: string[] }) {
  const { workspace, files = [], browserTabs = [] } = useWorkspace();
  const t = useT();
  const seen = new Set(attachedIds.map(id => `file:${id}`));
  const text = content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '');
  const cards = [];
  for (const match of text.matchAll(/(?<!!)\[([^\]\n]+)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g)) {
    const artifact = artifactFromLink(match[2] || match[3], files, browserTabs, workspace?.slug || workspace?.workspaceId || '');
    if (!artifact || seen.has(`${artifact.kind}:${artifact.id}`)) continue;
    seen.add(`${artifact.kind}:${artifact.id}`);
    const file = artifact.kind === 'file' ? files.find(item => item.id === artifact.id) : null;
    const html = file?.contentType === 'text/html' || /\.html?$/i.test(file?.filename || match[1]);
    cards.push({ artifact, title: file?.filename.split('/').at(-1) || match[1], Icon: artifact.kind === 'browser' ? Globe : html ? FileCode2 : FileText });
  }
  if (!cards.length) return null;
  return <div className="mt-2 space-y-2">
    {cards.map(({ artifact, title, Icon }) => <button
      key={`${artifact.kind}:${artifact.id}`}
      type="button"
      aria-label={`${t('artifactPanel.open')}: ${title}`}
      onClick={() => openArtifactPreview(artifact)}
      className="flex w-full max-w-xl items-center gap-3 rounded-lg border bg-muted/30 px-3 py-3 text-left transition-colors hover:bg-muted/60"
    >
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"><PanelRight className="size-3.5" />{t('artifact.preview')}</span>
    </button>)}
  </div>;
}
