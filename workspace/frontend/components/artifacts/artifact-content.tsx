'use client';
import { useEffect, useState } from 'react';
import { WEB_PROJECT_TYPE } from '@/lib/web-projects';
import { ProjectPreview } from './project-preview';
import { Spinner } from '@/components/ui/spinner';
import { workspaceApi } from '@/lib/api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useWorkspace } from '@/lib/workspace-context';
import { BrowserArtifactPreview } from './browser-artifact-preview';
import { ArtifactBody, readArtifactResponse, type LoadedArtifact } from './artifact-body';
import type { ArtifactReference } from '@/lib/thread-artifacts';

export function ArtifactContent({ artifact, revision }: { artifact: ArtifactReference; revision: number }) {
  const { files } = useWorkspace();
  const { idToken } = useOpenAgentsAuth();
  const file = artifact.kind === 'file' ? files.find(f => f.id === artifact.id) : null;
  const [loaded, setLoaded] = useState<(LoadedArtifact & { key: string }) | null>(null);
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
      const result = await readArtifactResponse(response, { contentType: file?.contentType, filename: file?.filename, size: file?.size }, abort.signal);
      if (!result) return;
      objectUrl = result.url;
      if (abort.signal.aborted) { if (objectUrl) URL.revokeObjectURL(objectUrl); return; }
      setLoaded({ key, ...result });
    };
    void load().catch(() => { if (!abort.signal.aborted) setLoaded({key,failed:true}); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [key, file?.contentType, file?.filename]);
  if (artifact.kind === 'browser') return <BrowserArtifactPreview tabId={artifact.id} revision={revision} />;
  if (file?.contentType === WEB_PROJECT_TYPE || (loaded?.key === key && loaded.type === 'project')) return <ProjectPreview id={artifact.id} revision={revision} showDetails={false} />;
  if (!loaded || loaded.key !== key) return <div className="flex h-full items-center justify-center"><Spinner className="size-5 text-muted-foreground" /></div>;
  return <ArtifactBody key={loaded.key} loaded={loaded} filename={file?.filename || ''} />;
}
