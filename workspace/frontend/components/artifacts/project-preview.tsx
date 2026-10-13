'use client';
import { useEffect, useState } from 'react';
import { Loader2, FolderTree } from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useT } from '@/lib/i18n';
import type { ProjectPreview as Preview } from '@/lib/web-projects';
import { ProjectUpload } from './project-upload';

export function ProjectPreview({id, revision=0}: {id: string; revision?: number}) {
  const t = useT(); const {idToken} = useOpenAgentsAuth();
  const [data,setData] = useState<Preview|null>(null); const [failed,setFailed] = useState(false);
  const [version,setVersion] = useState(0); const [tree,setTree] = useState(false);
  useEffect(()=>{
    let active=true; setData(null); setFailed(false);
    void workspaceApi.previewWebProject(id).then(result=>{if(active)setData(result);}).catch(()=>{if(active)setFailed(true);});
    const refresh=setTimeout(()=>setVersion(v=>v+1),55*60*1000);
    return ()=>{active=false;clearTimeout(refresh);};
  },[id,revision,version,idToken]);
  useEffect(()=>{
    if(!data) return;
    let active=true;
    const poll=setInterval(()=>{
      if(document.visibilityState==='hidden') return;
      void workspaceApi.getWebProjectRevision(id).then(latest=>{
        if(active && latest.revision!==data.revision) setVersion(v=>v+1);
      }).catch(()=>{if(active){setData(null);setFailed(true);}});
    },15000);
    return ()=>{active=false;clearInterval(poll);};
  },[id,data]);
  if(failed) return <p role="alert" className="p-5 text-sm text-muted-foreground">{t('artifactPanel.unavailable')}</p>;
  if(!data) return <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin" /></div>;
  return <div className="flex h-full min-h-0 flex-col">
    <div className="shrink-0 space-y-2 border-b p-3">
      <button className="flex items-center gap-2 text-xs text-muted-foreground" onClick={()=>setTree(!tree)} aria-expanded={tree}><FolderTree className="size-4" />{data.entrypoint} · {data.files.length} {t('webProject.files')}</button>
      {tree && <ul className="max-h-36 overflow-auto rounded bg-muted/30 p-2 font-mono text-xs">{data.files.map(path=><li key={path} className="py-0.5">{path}</li>)}</ul>}
      {data.can_update&&<ProjectUpload projectId={id} revision={data.revision} onPublished={()=>setVersion(v=>v+1)} />}
    </div>
    <iframe key={data.preview_path} title={t('webProject.preview')} src={data.preview_path} sandbox="allow-scripts" referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0 bg-white" />
  </div>;
}
