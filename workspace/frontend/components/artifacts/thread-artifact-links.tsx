'use client';
import { FileText, Globe, PanelRight } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { isDocumentFile, openArtifactPreview } from '@/lib/thread-artifacts';
import { tabHasFreshAgentActivity } from '@/components/browser/agent-activity';
import { useT } from '@/lib/i18n';
/** Quick access to outputs and browser work without leaving the conversation. */
export function ThreadArtifactLinks() {
  const t=useT();
  const { files,browserTabs,currentSessionId,sessions }=useWorkspace();
  const {setSplitBrowser,setShowBrowserPreview}=useLayout();
  const currentSession=sessions.find(session=>session.sessionId===currentSessionId);
  const docs=files.filter(file=>file.channelName===currentSessionId&&isDocumentFile(file)).slice(0,3);
  const tabs=browserTabs.filter(tab=>tabHasFreshAgentActivity(tab)&&(currentSession?.participants||[]).includes((tab.activity?.actor||tab.createdBy).replace(/^openagents:/,''))).slice(0,2);
  if (!docs.length&&!tabs.length) return null;
  return <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b px-4 py-2 text-xs text-muted-foreground">
    <button type="button" className="flex shrink-0 items-center gap-1 hover:text-foreground" onClick={()=>{setSplitBrowser(true);setShowBrowserPreview(true);}}><PanelRight className="size-3.5" />{t('artifactPanel.title')}</button>
    {docs.map(file=><button key={file.id} type="button" className="flex max-w-48 shrink-0 items-center gap-1 rounded border px-2 py-1 hover:bg-muted" onClick={()=>openArtifactPreview({kind:'file',id:file.id})}><FileText className="size-3 shrink-0" /><span className="truncate">{file.filename.split('/').at(-1)}</span></button>)}
    {tabs.map(tab=><button key={tab.id} type="button" className="flex max-w-52 shrink-0 items-center gap-1 rounded border border-emerald-500/30 px-2 py-1 hover:bg-muted" onClick={()=>openArtifactPreview({kind:'browser',id:tab.id})}><Globe className="size-3 shrink-0 text-emerald-500" /><span className="truncate">{tab.title||tab.url}</span></button>)}
  </div>;
}
