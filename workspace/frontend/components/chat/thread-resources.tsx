'use client';

import { workspaceApi } from '@/lib/api';
import { toast } from 'sonner';
import { THREAD_PARTICIPANTS_CHANGED } from '@/lib/thread-participants';
import { useEffect, useRef, useState } from 'react';
import { useDragScroll } from './use-drag-scroll';
import { ArrowUpRight, Bot, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Globe, Layers, ListOrdered, PencilLine, X } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { AgentOwnershipBadge, AgentSharingAction, useThreadCollaboration } from './agent-message-access';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { BrowserThumbnail } from '@/components/artifacts/browser-thumbnail';
import { FileTile } from '@/components/files/file-utils';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';
import { openArtifactPreview } from '@/lib/thread-artifacts';
import { projectDisplayName } from '@/lib/web-projects';
import { tabHasFreshAgentActivity } from '@/components/browser/agent-activity';
import { resolveThreadBrowserLink, threadBrowserLinks, threadBrowserArtifacts } from '@/lib/thread-browser';
import type { WorkspaceMessage } from '@/lib/types';
import { useQueuedMessages, type PendingQueueEntry } from './use-queued-messages';

const ROW = 'no-scrollbar flex cursor-grab select-none flex-nowrap gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain snap-x snap-proximity data-[dragging=true]:cursor-grabbing data-[dragging=true]:[&_*]:cursor-grabbing';

/** A small, bounded shelf: conversation resources without taking over the chat. */
export function ThreadResources({ messages = [], queueMessages = [], pendingQueue = [] }: { messages?: WorkspaceMessage[]; queueMessages?: WorkspaceMessage[]; pendingQueue?: PendingQueueEntry[] }) {
  const t = useT();
  const collaboration = useThreadCollaboration();
  const [saving, setSaving] = useState(false);
  const [reviewAfter, setReviewAfter] = useState<string | null>(null);
  const artifactDrag = useDragScroll();
  const agentDrag = useDragScroll();
  const queueDrag = useDragScroll();
  const { agents, files, browserTabs, currentSessionId, sessions } = useWorkspace();
  const { selectedArtifact, selectedBrowser, setSelectedAgentName } = useLayout();
  const participants = sessions.find(s => s.sessionId === currentSessionId)?.participants || [];
  const members = currentSessionId?.startsWith('dm:') ? [] : agents.filter(a => participants.includes(a.agentName));
  const documents = files.filter(f => f.channelName === currentSessionId && !f.filename.endsWith('/.keep'));
  const browsers = threadBrowserArtifacts(browserTabs, currentSessionId || '', messages);
  const linkedBrowsers = threadBrowserLinks(messages, currentSessionId || '').filter(url => !resolveThreadBrowserLink(url, browserTabs, currentSessionId || '', messages));
  const artifactRow = useRef<HTMLUListElement>(null);
  const agentRow = useRef<HTMLUListElement>(null);
  const queueRow = useRef<HTMLUListElement>(null);
  const scrollRow = (direction: number) => (active === 'agents' ? agentRow : active === 'queue' ? queueRow : artifactRow).current?.scrollBy({ left: direction * 336, behavior: 'smooth' });
  const [section, setSection] = useState('artifacts');
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const { queued, cancel: cancelQueued } = useQueuedMessages(currentSessionId, queueMessages, pendingQueue);
  // A newly queued message opens the Queue tab; it disappears once the queue drains.
  const queuedCount = useRef(queued.length);
  useEffect(() => {
    if (queued.length > queuedCount.current) { setSection('queue'); setCollapsed(false); }
    queuedCount.current = queued.length;
  }, [queued.length]);
  const artifactCount = documents.length + browsers.length + linkedBrowsers.length;
  if (!members.length && !artifactCount && !queued.length) return null;
  const active = section === 'queue' ? (queued.length ? 'queue' : 'artifacts') : section === 'agents' && members.length ? 'agents' : 'artifacts';
  const showArrows = !collapsed && (active === 'artifacts' ? artifactCount : active === 'queue' ? queued.length : members.length) > 1;
  const selectedAgent = members.find(a => a.agentName === editing);
  const editable = !!selectedAgent && collaboration.canEdit(selectedAgent);
  // The backend only accepts another agent that is already in this thread as reviewer.
  const reviewers = selectedAgent ? members.filter(agent => agent.agentName !== selectedAgent.agentName) : [];
  return <section className="min-w-0 shrink-0 border-b bg-muted/15 px-3 py-2" aria-label={t('threadResources.title')}>
    <Tabs value={active} onValueChange={value => { setSection(value); setCollapsed(false); }} className="min-w-0 gap-1.5">
      <div className="flex items-center gap-2">
        <TabsList className="h-7" aria-label={t('threadResources.title')}>
          {queued.length > 0 && <TabsTrigger value="queue" className="px-2 text-xs"><ListOrdered />{t('threadResources.queue')}<span className="tabular-nums text-muted-foreground">{queued.length}</span></TabsTrigger>}
          <TabsTrigger value="artifacts" className="px-2 text-xs"><Layers />{t('artifactPanel.title')}<span className="tabular-nums text-muted-foreground">{artifactCount}</span></TabsTrigger>
          {members.length > 0 && <TabsTrigger value="agents" className="px-2 text-xs"><Bot />{t('threadResources.agents')}<span className="tabular-nums text-muted-foreground">{members.length}</span></TabsTrigger>}
        </TabsList>
        {showArrows && <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon-xs" aria-label={t('threadResources.scrollLeft')} onClick={() => scrollRow(-1)}><ChevronLeft /></Button>
          <Button variant="outline" size="icon-xs" aria-label={t('threadResources.scrollRight')} onClick={() => scrollRow(1)}><ChevronRight /></Button>
        </div>}
        <Button variant="ghost" size="icon-xs" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-label={t(collapsed ? 'threadResources.expand' : 'threadResources.collapse')} className={cn('text-muted-foreground', !showArrows && 'ml-auto')}>{collapsed ? <ChevronDown /> : <ChevronUp />}</Button>
      </div>
      {!collapsed && <>
        <TabsContent value="queue" className="mt-0 min-w-0">
          <ul {...queueDrag} ref={queueRow} aria-label={t('threadResources.queue')} className={ROW}>
            {queued.map((q, i) => <li key={q.queueId} className="flex w-64 shrink-0 snap-start flex-col gap-1 rounded-lg border bg-background p-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">{q.pending ? t('threadResources.queuing') : t('threadResources.queuedPosition', { position: i + 1 })}</span>
                {!q.pending && <Button variant="outline" size="xs" onClick={() => void cancelQueued(q.queueId)} aria-label={t('threadStatus.cancelQueuedMessage')} title={t('threadStatus.cancelQueuedMessage')}><X data-icon="inline-start" />{t('common.cancel')}</Button>}
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-4" title={q.content}>{q.content}</p>
            </li>)}
          </ul>
        </TabsContent>
        <TabsContent value="agents" className="mt-0 min-w-0">
          <ul {...agentDrag} ref={agentRow} aria-label={t('threadResources.agents')} className={ROW}>
            {members.map(agent => <li key={agent.agentName} className="flex w-64 shrink-0 snap-start flex-col items-start gap-1 rounded-lg border bg-background p-2"><div className="flex w-full items-center gap-2">
              <button type="button" onClick={() => setSelectedAgentName(agent.agentName)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left hover:bg-muted/50" title={agent.description ? `${agentLabel(agent)} — ${agent.description}` : agentLabel(agent)}>
                <span className="shrink-0"><AgentAvatar name={agent.agentName} size={28} status={agent.status} showStatus /></span>
                <span className="min-w-0 flex-1 py-0.5">
                  <span className="block truncate text-xs font-medium leading-4">{agentLabel(agent)}</span><AgentOwnershipBadge agent={agent} compact />
                  <span className="mt-0.5 block truncate text-xs leading-4 text-muted-foreground">{collaboration.roles[agent.agentName]?.instructions ? <><span className="font-medium text-foreground/70">{t('threadResources.roleThisThread')}</span> {collaboration.roles[agent.agentName].instructions}</> : agent.description?.trim() ? <><span className="font-medium text-foreground/70">{t('threadResources.roleWorkspace')}</span> {agent.description.trim()}</> : t('threadResources.noRole')}</span>
                </span>
              </button>
              <Button variant="outline" size="icon-sm" aria-label={t('threadResources.instructAgent', { agent: agentLabel(agent) })} title={t('threadResources.instruct')} onClick={() => { setEditing(agent.agentName); setInstruction(collaboration.roles[agent.agentName]?.instructions || ''); setReviewAfter(collaboration.roles[agent.agentName]?.review_after || null); }} className="text-muted-foreground"><PencilLine /></Button>
            </div><AgentSharingAction agentName={agent.agentName} /></li>)}
          </ul>
          {selectedAgent && <form className="mt-2 flex flex-col gap-1.5 rounded-lg border bg-background p-2" onSubmit={event => {
            event.preventDefault(); if (saving || !currentSessionId || !editable) return;
            setSaving(true);
            void workspaceApi.saveThreadCollaboration(currentSessionId, selectedAgent.agentName, instruction.trim(), reviewAfter).then(() => {
              window.dispatchEvent(new Event(THREAD_PARTICIPANTS_CHANGED)); setEditing(null); toast.success(t('threadCollaboration.saved'));
            }).catch(error => toast.error(error instanceof Error ? error.message : t('files.loadFailed'))).finally(() => setSaving(false));
          }}>
            <div className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate font-medium">{t('threadResources.instructAgent', { agent: agentLabel(selectedAgent) })}</span><Button type="button" variant="ghost" size="icon-xs" aria-label={t('threadResources.cancel')} onClick={() => setEditing(null)}><X /></Button></div>
            <Textarea autoFocus={editable} readOnly={!editable} value={instruction} onChange={event => setInstruction(event.target.value)} rows={2} aria-label={t('threadResources.instructions')} placeholder={t('threadResources.placeholder')} className="min-h-0 resize-none px-2 py-1 md:text-xs" />
            <label className="flex items-center gap-2 text-xs">{t('threadCollaboration.reviewAfter')}<select value={reviewAfter || ''} disabled={!editable || !reviewers.length} onChange={event => setReviewAfter(event.target.value || null)} className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"><option value="">{t(reviewers.length ? 'threadCollaboration.noReview' : 'threadCollaboration.noReviewer')}</option>{reviewers.map(agent => <option key={agent.agentName} value={agent.agentName}>{agentLabel(agent)}</option>)}</select></label>
            <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{t(!collaboration.supported ? 'threadCollaboration.rolloutPending' : editable ? 'threadCollaboration.onlyHere' : 'threadCollaboration.noPermission')}</span><Button type="submit" size="xs" disabled={saving || !editable}>{t('common.save')}</Button></div>
          </form>}
        </TabsContent>
        <TabsContent value="artifacts" className="mt-0 min-w-0">
          <ul {...artifactDrag} ref={artifactRow} aria-label={t('artifactPanel.title')} className={ROW}>
            {browsers.map(tab => <li key={tab.id} className="w-40 shrink-0 snap-start"><button type="button" onClick={() => openArtifactPreview({ kind: 'browser', id: tab.id })} title={tab.title || tab.url} aria-pressed={selectedBrowser?.id === tab.id} className="group flex h-full w-full flex-col gap-1.5 rounded-lg border bg-background p-1.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 aria-pressed:border-primary/50 aria-pressed:bg-primary/5">
              <span className="relative flex h-16 w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-md border border-success/20 bg-success/10 text-success"><Globe className="size-6" /><span className="max-w-full truncate px-2 text-xs">{tabHasFreshAgentActivity(tab) ? t('threadResources.browsing', { agent: (tab.activity?.actor || '').replace(/^openagents:/, '') }) : t('threadResources.liveBrowser')}</span>
                <BrowserThumbnail tabId={tab.id} pageUrl={tab.url} title={tab.title || tab.url} enabled={!tab.asleep} className="absolute inset-0 h-full border-0" />
              </span>
              <span className="flex w-full min-w-0 items-center gap-1 px-0.5"><span className="min-w-0 flex-1 truncate text-xs font-medium">{tab.title || tab.url}</span><ArrowUpRight className="size-3 shrink-0 text-muted-foreground" /></span>
            </button></li>)}
            {linkedBrowsers.map(url => <li key={url} className="w-40 shrink-0 snap-start"><button type="button" onClick={() => openArtifactPreview({ kind: 'browser', id: url })} className="flex h-full w-full flex-col gap-1.5 rounded-lg border bg-background p-1.5 text-left hover:bg-muted/50"><span className="flex h-20 w-full items-center justify-center rounded bg-muted"><Globe className="size-7 text-success" /></span><span className="flex w-full items-center justify-between gap-2 text-xs"><span>{t('threadLiveBrowser.shared')}</span><ArrowUpRight className="size-3 shrink-0" /></span></button></li>)}
            {documents.map(file => <li key={file.id} className="w-40 shrink-0 snap-start"><button type="button" onClick={() => openArtifactPreview({ kind: 'file', id: file.id })} title={projectDisplayName(file.filename.split('/').at(-1) || file.filename, file.contentType)} aria-pressed={selectedArtifact?.kind === 'file' && selectedArtifact.id === file.id} className="group flex h-full w-full flex-col gap-1.5 rounded-lg border bg-background p-1.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 aria-pressed:border-primary/50 aria-pressed:bg-primary/5">
              <FileTile file={file} className="h-16 w-full rounded-md shadow-none" />
              <span className="flex w-full min-w-0 items-center gap-1 px-0.5"><span className="min-w-0 flex-1 truncate text-xs font-medium">{projectDisplayName(file.filename.split('/').at(-1) || file.filename, file.contentType)}</span><ArrowUpRight className="size-3 shrink-0 text-muted-foreground" /></span>
            </button></li>)}
          </ul>
          {!artifactCount && <p className="py-2 text-xs text-muted-foreground">{t('threadResources.empty')}</p>}
        </TabsContent>
      </>}
    </Tabs>
  </section>;
}
