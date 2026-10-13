'use client';
import { useEffect, useState } from 'react';
import { WEB_PROJECT_TYPE } from '@/lib/web-projects';
import { ProjectPreview } from './project-preview';
import { Loader2 } from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useWorkspace } from '@/lib/workspace-context';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { BrowserView } from '@/components/browser/browser-view';
import { useT } from '@/lib/i18n';
import type { ArtifactReference } from '@/lib/thread-artifacts';

export function ArtifactContent({ artifact, revision }: { artifact: ArtifactReference; revision: number }) {
  const t = useT();
  const { files, browserTabs, refreshBrowserTabs } = useWorkspace();
  const [checkedBrowser, setCheckedBrowser] = useState<string | null>(null);
  useEffect(() => {
    if (artifact.kind !== 'browser') return;
    let active = true;
    void refreshBrowserTabs().catch(() => {}).finally(() => { if (active) setCheckedBrowser(artifact.id); });
    return () => { active = false; };
  }, [artifact.kind, artifact.id, refreshBrowserTabs]);
  const { idToken } = useOpenAgentsAuth();
  const file = artifact.kind === 'file' ? files.find(f => f.id === artifact.id) : null;
  const [loaded, setLoaded] = useState<{ key: string; text?: string; url?: string; type?: string; failed?: boolean } | null>(null);
  const key = `${artifact.kind}:${artifact.id}:${revision}:${idToken}`;
  useEffect(() => {
    if (artifact.kind === 'browser' || file?.contentType === WEB_PROJECT_TYPE) return;
    const abort = new AbortController(); let objectUrl: string | undefined;
    setLoaded(null);
    const load = async () => {
      if (artifact.kind === 'knowledge') {
        const entry = await workspaceApi.getKnowledgeEntry(artifact.id);
        if (!abort.signal.aborted) setLoaded({ key, text: entry.content, type: 'markdown' });
        return;
      }
      const response = await workspaceApi.fetchFile(artifact.id, abort.signal);
      const type = file?.contentType || response.headers.get('content-type') || '';
      const filename = file?.filename || '';
      if (type.includes(WEB_PROJECT_TYPE)) {
        await response.body?.cancel();
        if (!abort.signal.aborted) setLoaded({key,type:'project'});
      } else if (/text\/html/.test(type) || /\.html?$/i.test(filename)) {
        const text = await response.text();
        if (!abort.signal.aborted) setLoaded({key,text,type:'html'});
      } else if (type.startsWith('text/') || /\.(mdx?|json|csv)$/i.test(filename)) {
        const text = await response.text();
        if (!abort.signal.aborted) setLoaded({key,text,type: /markdown/.test(type) || /\.mdx?$/i.test(filename) ? 'markdown' : 'text'});
      } else {
        const blob = await response.blob(); if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setLoaded({key,url:objectUrl,type});
      }
    };
    void load().catch(() => { if (!abort.signal.aborted) setLoaded({key,failed:true}); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [key, file?.contentType, file?.filename]);
  if (artifact.kind === 'browser') return browserTabs.some(tab => tab.id === artifact.id) ? <BrowserView artifactTabId={artifact.id} /> : checkedBrowser !== artifact.id ? <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : <p className="p-6 text-sm text-muted-foreground">{t('artifactPanel.unavailable')}</p>;
  if (file?.contentType === WEB_PROJECT_TYPE || (loaded?.key === key && loaded.type === 'project')) return <ProjectPreview id={artifact.id} revision={revision} />;
  if (!loaded || loaded.key !== key) return <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (loaded.failed) return <p role="alert" className="p-6 text-sm text-muted-foreground">{t('artifactPanel.unavailable')}</p>;
  if (loaded.type === 'html') return <iframe title={file?.filename || t('artifactPanel.html')} srcDoc={loaded.text} sandbox="allow-scripts" referrerPolicy="no-referrer" className="h-full w-full border-0 bg-white" />;
  if (loaded.type === 'markdown') return <article className="h-full overflow-auto p-6"><MarkdownContent content={loaded.text || ''} agentNames={[]} /></article>;
  if (loaded.text !== undefined) return <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-5 text-sm">{loaded.text}</pre>;
  if (loaded.type?.startsWith('image/')) return <div className="flex h-full items-center justify-center overflow-auto p-4"><img src={loaded.url} alt={file?.filename || ''} className="max-h-full max-w-full object-contain" /></div>;
  if (loaded.type?.includes('pdf')) return <iframe src={loaded.url} title={file?.filename || t('artifactPanel.document')} className="h-full w-full border-0" />;
  return <div className="p-6"><a className="text-sm text-primary underline" href={loaded.url} download={file?.filename}>{t('artifactPanel.download')}</a></div>;
}
