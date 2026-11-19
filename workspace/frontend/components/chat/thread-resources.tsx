'use client';

import { workspaceApi } from '@/lib/api';
import { toast } from 'sonner';
import { THREAD_PARTICIPANTS_CHANGED } from '@/lib/thread-participants';
import { useEffect, useId, useRef, useState } from 'react';
import { useDragScroll } from './use-drag-scroll';
import { Bot, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Layers, ListOrdered, PencilLine, X } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { AgentOwnershipBadge, AgentSharingAction, useThreadCollaboration } from './agent-message-access';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';
import { resolveThreadBrowserLink, threadBrowserLinks, threadBrowserArtifacts } from '@/lib/thread-browser';
import type { WorkspaceMessage } from '@/lib/types';
import { useQueuedMessages, type PendingQueueEntry } from './use-queued-messages';
import { BrowserResourceTile, FileResourceTile, LinkedBrowserResourceTile } from './thread-resource-tiles';
import { WithTooltip } from '@/components/ui/with-tooltip';

// Radix Select has no empty value; this stands for "no reviewer".
const NO_REVIEW = '__none__';
const ROW = 'no-scrollbar flex cursor-grab select-none flex-nowrap gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain snap-x snap-proximity data-[dragging=true]:cursor-grabbing data-[dragging=true]:[&_*]:cursor-grabbing';

/** A small, bounded shelf: conversation resources without taking over the chat. */
export function ThreadResources({ messages = [], queueMessages = [], pendingQueue = [] }: { messages?: WorkspaceMessage[]; queueMessages?: WorkspaceMessage[]; pendingQueue?: PendingQueueEntry[] }) {
  const t = useT();
  const collaboration = useThreadCollaboration();
  const [saving, setSaving] = useState(false);
  const [reviewAfter, setReviewAfter] = useState<string | null>(null);
  const reviewId = useId();
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
                {!q.pending && <WithTooltip label={t('threadStatus.cancelQueuedMessage')}><Button variant="outline" size="xs" onClick={() => void cancelQueued(q.queueId)} aria-label={t('threadStatus.cancelQueuedMessage')}><X data-icon="inline-start" />{t('common.cancel')}</Button></WithTooltip>}
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-4">{q.content}</p>
            </li>)}
          </ul>
        </TabsContent>
        <TabsContent value="agents" className="mt-0 min-w-0">
          <ul {...agentDrag} ref={agentRow} aria-label={t('threadResources.agents')} className={ROW}>
            {members.map(agent => <li key={agent.agentName} className="flex w-64 shrink-0 snap-start flex-col items-start gap-1 rounded-lg border bg-background p-2"><div className="flex w-full items-center gap-2">
              <button type="button" onClick={() => setSelectedAgentName(agent.agentName)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
                <span className="shrink-0"><AgentAvatar name={agent.agentName} size={28} status={agent.status} showStatus /></span>
                <span className="min-w-0 flex-1 py-0.5">
                  <span className="block truncate text-xs font-medium leading-4">{agentLabel(agent)}</span><AgentOwnershipBadge agent={agent} compact />
                  <span className="mt-0.5 block truncate text-xs leading-4 text-muted-foreground">{collaboration.roles[agent.agentName]?.instructions ? <><span className="font-medium text-foreground/70">{t('threadResources.roleThisThread')}</span> {collaboration.roles[agent.agentName].instructions}</> : agent.description?.trim() ? <><span className="font-medium text-foreground/70">{t('threadResources.roleWorkspace')}</span> {agent.description.trim()}</> : t('threadResources.noRole')}</span>
                </span>
              </button>
              <WithTooltip label={t('threadResources.instruct')}><Button variant="outline" size="icon-sm" aria-label={t('threadResources.instructAgent', { agent: agentLabel(agent) })} onClick={() => { setEditing(agent.agentName); setInstruction(collaboration.roles[agent.agentName]?.instructions || ''); setReviewAfter(collaboration.roles[agent.agentName]?.review_after || null); }} className="text-muted-foreground"><PencilLine /></Button></WithTooltip>
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
            <div className="flex items-center gap-2"><Label htmlFor={reviewId} className="text-xs font-normal">{t('threadCollaboration.reviewAfter')}</Label><Select value={reviewAfter || NO_REVIEW} disabled={!editable || !reviewers.length} onValueChange={value => setReviewAfter(value === NO_REVIEW ? null : value)}>
              <SelectTrigger id={reviewId} size="sm" className="min-w-0 flex-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NO_REVIEW}>{t(reviewers.length ? 'threadCollaboration.noReview' : 'threadCollaboration.noReviewer')}</SelectItem>{reviewers.map(agent => <SelectItem key={agent.agentName} value={agent.agentName}>{agentLabel(agent)}</SelectItem>)}</SelectContent>
            </Select></div>
            <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{t(!collaboration.supported ? 'threadCollaboration.rolloutPending' : editable ? 'threadCollaboration.onlyHere' : 'threadCollaboration.noPermission')}</span><Button type="submit" size="xs" disabled={saving || !editable}>{t('common.save')}</Button></div>
          </form>}
        </TabsContent>
        <TabsContent value="artifacts" className="mt-0 min-w-0">
          <ul {...artifactDrag} ref={artifactRow} aria-label={t('artifactPanel.title')} className={ROW}>
            {browsers.map(tab => <BrowserResourceTile key={tab.id} tab={tab} pressed={selectedBrowser?.id === tab.id} />)}
            {linkedBrowsers.map(url => <LinkedBrowserResourceTile key={url} url={url} />)}
            {documents.map(file => <FileResourceTile key={file.id} file={file} pressed={selectedArtifact?.kind === 'file' && selectedArtifact.id === file.id} />)}
          </ul>
          {!artifactCount && <p className="py-2 text-xs text-muted-foreground">{t('threadResources.empty')}</p>}
        </TabsContent>
      </>}
    </Tabs>
  </section>;
}
