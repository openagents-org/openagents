'use client';

import { useState } from 'react';
import { ArrowUpRight, Bot, ChevronDown, ChevronUp, Globe, Layers, PencilLine, X } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { FileRowIcon } from '@/components/files/file-utils';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';
import { openArtifactPreview } from '@/lib/thread-artifacts';
import { projectDisplayName } from '@/lib/web-projects';
import { tabHasFreshAgentActivity } from '@/components/browser/agent-activity';

/** A small, bounded shelf: conversation resources without taking over the chat. */
export function ThreadResources({ onInstruct }: { onInstruct: (agent: string, instruction: string) => void }) {
  const t = useT();
  const { agents, files, browserTabs, currentSessionId, sessions } = useWorkspace();
  const { selectedArtifact, setSelectedAgentName } = useLayout();
  const participants = sessions.find(s => s.sessionId === currentSessionId)?.participants || [];
  const members = currentSessionId?.startsWith('dm:') ? [] : agents.filter(a => participants.includes(a.agentName));
  const documents = files.filter(f => f.channelName === currentSessionId && !f.filename.endsWith('/.keep'));
  const browsers = browserTabs.filter(tab => tab.status === 'active' && tab.artifactChannels?.includes(currentSessionId || ''));
  const [section, setSection] = useState('agents');
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const artifactCount = documents.length + browsers.length;
  if (!members.length && !artifactCount) return null;
  const active = members.length ? section : 'artifacts';
  const selectedAgent = members.find(a => a.agentName === editing);
  return <section className="shrink-0 border-b bg-muted/15 px-3 py-2" aria-label={t('threadResources.title')}>
    <Tabs value={active} onValueChange={value => { setSection(value); setCollapsed(false); }} className="gap-1.5">
      <div className="flex items-center gap-2">
        <TabsList className="h-7" aria-label={t('threadResources.title')}>
          {members.length > 0 && <TabsTrigger value="agents" className="gap-1.5 px-2 text-xs"><Bot className="size-3.5" />{t('threadResources.agents')}<span className="tabular-nums text-muted-foreground">{members.length}</span></TabsTrigger>}
          <TabsTrigger value="artifacts" className="gap-1.5 px-2 text-xs"><Layers className="size-3.5" />{t('artifactPanel.title')}<span className="tabular-nums text-muted-foreground">{artifactCount}</span></TabsTrigger>
        </TabsList>
        <button type="button" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-label={t(collapsed ? 'threadResources.expand' : 'threadResources.collapse')} className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted">{collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}</button>
      </div>
      {!collapsed && <>
        <TabsContent value="agents" className="mt-0">
          <p className="mb-1 text-[11px] text-muted-foreground">{t('threadResources.guide')}</p>
          <ul className="max-h-32 overflow-y-auto overscroll-contain divide-y divide-border/50">
            {members.map(agent => <li key={agent.agentName} className="flex min-w-0 items-center gap-2 py-1.5">
              <AgentAvatar name={agent.agentName} size={28} status={agent.status} showStatus />
              <button type="button" onClick={() => setSelectedAgentName(agent.agentName)} className="min-w-0 flex-1 text-left" title={agent.description || agentLabel(agent)}>
                <span className="block truncate text-xs font-medium">{agentLabel(agent)}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{agent.description?.trim() || t('threadResources.noRole')}</span>
              </button>
              <button type="button" aria-label={t('threadResources.instructAgent', { agent: agentLabel(agent) })} onClick={() => { setEditing(agent.agentName); setInstruction(''); }} className="flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] hover:bg-muted"><PencilLine className="size-3" />{t('threadResources.instruct')}</button>
            </li>)}
          </ul>
          {selectedAgent && <form className="mt-2 rounded-lg border bg-background p-2" onSubmit={event => {
            event.preventDefault(); if (!instruction.trim()) return;
            onInstruct(selectedAgent.agentName, instruction.trim()); setEditing(null); setInstruction('');
          }}>
            <div className="mb-1 flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate font-medium">{t('threadResources.instructAgent', { agent: agentLabel(selectedAgent) })}</span><button type="button" aria-label={t('threadResources.cancel')} onClick={() => setEditing(null)} className="rounded p-1 hover:bg-muted"><X className="size-3" /></button></div>
            <textarea autoFocus value={instruction} onChange={event => setInstruction(event.target.value)} rows={2} aria-label={t('threadResources.instructions')} placeholder={t('threadResources.placeholder')} className="w-full resize-none rounded border bg-transparent px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring" />
            <div className="mt-1 flex items-center justify-between gap-2"><span className="text-[10px] text-muted-foreground">{t('threadResources.draftHint')}</span><button type="submit" disabled={!instruction.trim()} className="shrink-0 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">{t('threadResources.addDraft')}</button></div>
          </form>}
        </TabsContent>
        <TabsContent value="artifacts" className="mt-0">
          <ul className="max-h-36 overflow-y-auto overscroll-contain divide-y divide-border/50">
            {browsers.map(tab => <li key={tab.id}><button type="button" onClick={() => openArtifactPreview({ kind: 'browser', id: tab.id })} aria-pressed={selectedArtifact?.kind === 'browser' && selectedArtifact.id === tab.id} className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-muted aria-pressed:bg-muted">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-500"><Globe className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{tab.title || tab.url}</span><span className="block truncate text-[11px] text-muted-foreground">{tabHasFreshAgentActivity(tab) ? t('threadResources.browsing', { agent: (tab.activity?.actor || '').replace(/^openagents:/, '') }) : t('threadResources.liveBrowser')}</span></span><ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
            </button></li>)}
            {documents.map(file => <li key={file.id}><button type="button" onClick={() => openArtifactPreview({ kind: 'file', id: file.id })} aria-pressed={selectedArtifact?.kind === 'file' && selectedArtifact.id === file.id} className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-muted aria-pressed:bg-muted">
              <FileRowIcon file={file} /><span className="min-w-0 flex-1 truncate text-xs" title={projectDisplayName(file.filename.split('/').at(-1) || file.filename, file.contentType)}>{projectDisplayName(file.filename.split('/').at(-1) || file.filename, file.contentType)}</span><ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
            </button></li>)}
          </ul>
          {!artifactCount && <p className="py-2 text-xs text-muted-foreground">{t('threadResources.empty')}</p>}
        </TabsContent>
      </>}
    </Tabs>
  </section>;
}
