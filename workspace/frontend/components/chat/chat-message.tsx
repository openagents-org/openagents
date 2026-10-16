'use client';

import { isWebProject, projectDisplayName } from '@/lib/web-projects';
import { MessageArtifacts } from '@/components/artifacts/message-artifacts';
import { openArtifactPreview } from '@/lib/thread-artifacts';
import { AuthenticatedImage } from '@/components/files/authenticated-image';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Reply, Copy, Check, Folder, FileIcon, Download, Eye, ArrowRight, ArrowRightLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { memo, useCallback, useMemo, useState } from 'react';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { AgentOwnershipBadge, AgentSharingAction } from './agent-message-access';
import { CopyMessageLink } from './copy-message-link';
import { MessageReactions } from './message-reactions';
import { MarkdownContent } from './markdown-content';
import { workspaceApi } from '@/lib/api';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useFormatters, useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';
import { approvalFromMetadata } from '@/lib/approvals';
import { ReplyCitation, type ReplyCitationData } from './reply-citation';
import { RoutingChoiceCard } from './routing-choice-card';
import { ApprovalCard } from './approval-card';
import { handoffFromMessage, type HandoffRecord } from '@/lib/handoff'; // v1.1 M6
import { isHtmlAttachment } from '@/lib/brief';
import { HtmlArtifactPreview } from './html-artifact-preview';
import { isMyAddress, myAddress } from '@/lib/dm';
import { HumanAvatar } from './human-avatar';
import { humanMessageContent } from '@/lib/message-content';
import { useHumanNames } from '@/hooks/use-team-roster';

interface Attachment {
  fileId: string;
  filename: string;
  contentType: string;
  url: string;
}

function isPreviewable(contentType: string, filename: string): boolean {
  if (isWebProject(contentType, filename) || /\.docx$/i.test(filename)) return true;
  if (contentType?.startsWith('image/')) return true;
  if (contentType === 'text/html' || /\.html?$/i.test(filename)) return true;
  if (contentType === 'text/markdown' || /\.mdx?$/i.test(filename)) return true;
  if (contentType?.startsWith('text/') || /\.(json|js|ts|tsx|jsx|py|rs|go|java|rb|sh|yaml|yml)$/i.test(filename)) return true;
  return false;
}

function Attachments({ items, senderAgentName = null }: { items: Attachment[]; senderAgentName?: string | null }) {
  if (!items || items.length === 0) return null;

  const openPreview = useCallback((fileId: string) => {
    openArtifactPreview({ kind: 'file', id: fileId });
  }, []);

  // Regenerate URLs from fileId to ensure they include current auth token
  const fixedItems = useMemo(() =>
    items.map((a) => ({ ...a, url: workspaceApi.getFileUrl(a.fileId) })),
    [items]
  );

  const images = fixedItems.filter((a) => a.contentType?.startsWith('image/'));
  // v1.1 M5: HTML artifacts get an inline sandboxed preview card instead of
  // a chip that only opens the Files pane.
  const htmlFiles = fixedItems.filter((a) => !a.contentType?.startsWith('image/') && isHtmlAttachment(a.contentType, a.filename));
  const files = fixedItems.filter((a) => !a.contentType?.startsWith('image/') && !isHtmlAttachment(a.contentType, a.filename));

  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img) => (
            <button
              key={img.fileId}
              type="button"
              onClick={() => openPreview(img.fileId)}
              className="block rounded-lg overflow-hidden border hover:shadow-md transition-shadow max-w-sm cursor-pointer text-left"
            >
              <AuthenticatedImage
                fileId={img.fileId}
                alt={img.filename}
                className="max-h-64 w-auto object-contain"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
      {htmlFiles.length > 0 && (
        <div className="space-y-2">
          {htmlFiles.map((file) => (
            <HtmlArtifactPreview
              key={file.fileId}
              fileId={file.fileId}
              filename={file.filename}
              url={file.url}
              senderAgentName={senderAgentName}
              onOpenFull={openPreview}
            />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((file) => {
            const previewable = isPreviewable(file.contentType, file.filename);
            return previewable ? (
              <button
                key={file.fileId}
                type="button"
                onClick={() => openPreview(file.fileId)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-muted hover:bg-muted/80 transition-colors text-sm cursor-pointer"
              >
                <span className="shrink-0 text-muted-foreground">{isWebProject(file.contentType,file.filename)?<Folder className="size-4" />:<Eye className="size-4" />}</span>
                <span className="truncate max-w-[200px]">{projectDisplayName(file.filename,file.contentType)}</span>
              </button>
            ) : (
              <button
                key={file.fileId}
                type="button"
                onClick={() => void workspaceApi.downloadFile(file.fileId, file.filename).catch(error => toast.error(error instanceof Error ? error.message : 'Download failed'))}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-muted hover:bg-muted/80 transition-colors text-sm"
              >
                <FileIcon className="size-4 text-muted-foreground shrink-0" />
                <span className="truncate max-w-[200px]">{projectDisplayName(file.filename,file.contentType)}</span>
                <Download className="size-3 text-muted-foreground shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ChatMessageProps {
  message: WorkspaceMessage;
  agents?: WorkspaceAgent[];
  /** True only for the trailing message — gates the suggestion chips. */
  isLast?: boolean;
  /** Send a suggested prompt as the user's message (tap-to-ask chips). */
  onSuggestion?: (text: string) => void;
  onMentionPerson?: (email: string) => void;
  onReply?: (message: WorkspaceMessage) => void;
  onRecall?: (message: WorkspaceMessage) => Promise<void>;
}

export const ChatMessage = memo(function ChatMessage({ message, agents = [], isLast = false, onSuggestion, onMentionPerson, onReply, onRecall }: ChatMessageProps) {
  const { currentUser } = useWorkspace();
  const t = useT();
  const { formatTime } = useFormatters();
  const isHuman = message.senderType === 'human' || message.senderType === 'user';
  const isSystem = message.messageType === 'status';
  // Requests from people or agents render as the same actionable approval card
  // (buttons and all) instead of prose. The plain-text content is what
  // history readers and bridges see; the card is built from the record.
  const approval = message.messageType === 'approval' ? approvalFromMetadata(message.metadata) : null;
  // v1.1 M6 — an agent handing work to another agent. The connector posts
  // "@to request…" as plain text and the same record in metadata.handoff;
  // the card renders the record so the sections stay readable.
  const handoff = !approval ? handoffFromMessage(message.metadata) : null;
  const continuation = message.metadata?.orchestration as { action?: string; agent?: string; task?: string; reason?: string } | undefined;
  const review = message.metadata?.review_handoff as { reviewers?: string[]; blocked?: string[] } | undefined;
  const [copied, setCopied] = useState(false);

  const agentNames = useMemo(() => agents.map((a) => a.agentName), [agents]);
  const agentLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const a of agents) {
      if (a.displayName) labels[a.agentName] = agentLabel(a);
    }
    return labels;
  }, [agents]);
  // People's @mentions (`@sam@demo.io`) render as "@Sam Okafor"; mentions of
  // the viewer get the stronger highlight.
  const humanNames = useHumanNames();
  const selfMention = currentUser.isAuthenticated && currentUser.id.includes('@') ? currentUser.id.toLowerCase() : undefined;
  const agent = agents.find((a) => a.agentName === message.senderName);
  const rawAttachments = (message.metadata?.attachments as Record<string, unknown>[]) || [];
  const attachments: Attachment[] = rawAttachments.map((a) => ({
    fileId: (a.fileId || a.file_id || '') as string,
    filename: (a.filename || '') as string,
    contentType: (a.contentType || a.content_type || '') as string,
    url: '',
  }));

  const humanContent = humanMessageContent(message.content, attachments);

  const timestamp = message.createdAt ? formatTime(message.createdAt) : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('chat.copyFailed'));
    }
  };

  // Status messages — subtle inline
  if (isSystem) {
    const isQueued = message.content.includes('queued');
    return (
      <div className="flex justify-center py-1">
        <span className={cn(
          'text-xs italic',
          isQueued
            ? 'text-foreground/80'
            : 'text-muted-foreground'
        )}>
          {agent ? agentLabel(agent) : message.senderName}: {message.content}
        </span>
      </div>
    );
  }

  // ── Human message ──
  // Everyone reads the same way: avatar + name + time on the left, like the
  // agent turns below. A shared workspace has several people in it, so your own
  // turns stay in the same column as theirs rather than becoming right-aligned
  // bubbles — the thread reads as one transcript.
  if (isHuman) {
    // In DMs the sender address identifies the viewer too — including legacy
    // conversations stored under the shared `human:user` address.
    const isCurrentUser = (!!message.senderId && message.senderId === currentUser.id)
      || (!!message.senderAddress && (message.sessionId || '').startsWith('dm:')
        && isMyAddress(message.senderAddress, myAddress(currentUser)));
    const mentionEmail = [message.senderAddress?.replace(/^human:/, ''), message.senderId, message.metadata?.sender_email]
      .find((value): value is string => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
    const seed = message.senderId || message.senderName || 'human';
    const displayName = isCurrentUser
      ? 'You'
      : ((mentionEmail && humanNames[mentionEmail.toLowerCase()]) || (message.senderName && message.senderName !== 'user' ? message.senderName : 'User'));

    return (
      <div className="group/message relative py-1.5">
        <div className="flex items-start gap-3">
          <HumanAvatar email={mentionEmail || (isCurrentUser ? currentUser.id : seed)} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {onMentionPerson && mentionEmail ? (
                <button type="button" onClick={() => onMentionPerson(mentionEmail.toLowerCase())}
                  className="text-sm font-semibold text-foreground cursor-pointer hover:underline focus-visible:underline"
                  title={t('peopleMessaging.mentionName', { name: displayName })}>
                  {displayName}
                </button>
              ) : <span className="text-sm font-semibold text-foreground">{displayName}</span>}
              {timestamp && (
                <span className="text-[11px] text-muted-foreground">{timestamp}</span>
              )}
              {/* v1.1 M5 — information vs execution in directed threads */}
              {message.metadata?.informational === true && (
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                  title={t('brief.infoTagHint')}
                >
                  {t('brief.infoTag')}
                </span>
              )}
              {message.metadata?.from_non_director === true && (
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  title={t('brief.nonDirectorHint')}
                >
                  {t('brief.nonDirectorTag')}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-sm leading-relaxed [&_.markdown-content>*:last-child]:mb-0">
              {message.metadata.recalled ? <p className="text-xs italic text-muted-foreground">{t('messageReply.recalled')}</p> : approval ? <ApprovalCard approval={approval} /> : <>
                <ReplyCitation citation={message.metadata.reply_to as ReplyCitationData | undefined} />
                {humanContent && <MarkdownContent content={humanContent} agentNames={agentNames} agentLabels={agentLabels} humanNames={humanNames} selfMention={selfMention} />}
                <Attachments items={attachments} />
              </>}
            </div>
            {!approval && !message.metadata.recalled && <RoutingChoiceCard message={message} agents={agents} />}
            {!approval && !message.metadata.recalled && <MessageReactions messageId={message.messageId}
              onReply={onReply ? () => onReply(message) : undefined}
              onRecall={isCurrentUser && onRecall && !message.messageId.startsWith('optimistic-')
                && message.targetAgents?.length === 1 && message.targetAgents[0] === '__no_response__'
                && !message.metadata.routing_assignment && !message.metadata.approval_id
                && (message.metadata.routing_choice as { status?: string } | undefined)?.status !== 'assigned'
                ? () => onRecall(message) : undefined} />}
          </div>
        </div>
      </div>
    );
  }

  // ── Agent message ──
  // Full-bleed, no bubble — ChatGPT's assistant turn. The avatar and name stay:
  // a thread can have several agents, so the author still has to be readable.
  return (
    <div className="group py-2">
      <div className="flex items-start gap-3">
        <AgentAvatar name={message.senderName} size={28} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="truncate text-sm font-semibold text-foreground">
              {agent ? agentLabel(agent) : message.senderName}
            </span>
            {agent && <AgentOwnershipBadge agent={agent} />}
            {timestamp && (
              <span className="text-[11px] text-muted-foreground">{timestamp}</span>
            )}
          </div>
          <div className="mt-0.5 text-sm leading-relaxed">
            {approval ? (
              <ApprovalCard approval={approval} />
            ) : handoff ? (
              <>
                <HandoffCard handoff={handoff} agents={agents} agentNames={agentNames} agentLabels={agentLabels} />
                <Attachments items={attachments} senderAgentName={message.senderName} />
                <MessageArtifacts content={message.content} attachedIds={attachments.map(item => item.fileId)} />
              </>
            ) : (
              <>
                <ReplyCitation citation={message.metadata.reply_to as ReplyCitationData | undefined} />
                <MarkdownContent content={message.content} agentNames={agentNames} agentLabels={agentLabels} humanNames={humanNames} selfMention={selfMention} />
                <Attachments items={attachments} senderAgentName={message.senderName} />
                <MessageArtifacts content={message.content} attachedIds={attachments.map(item => item.fileId)} />
              </>
            )}

            {!approval && continuation?.action === 'next' && typeof continuation.agent === 'string' && <p role="status" className="mt-2 text-xs text-muted-foreground">
              {t('routing.continuing', { agent: agentLabels[continuation.agent] || continuation.agent })}
              {typeof continuation.task === 'string' && <> · {continuation.task}</>}
            </p>}
            {!approval && continuation?.action === 'wait' && typeof continuation.reason === 'string' && <p role="status" className="mt-2 text-xs text-muted-foreground">{continuation.reason}</p>}
            {!approval && <RoutingChoiceCard message={message} agents={agents} />}

            {review && <div className="mt-2 text-xs text-muted-foreground" role="status">
              {Array.isArray(review.reviewers) && review.reviewers.length > 0 && <p>{t('reviewHandoff.sent', { agents: review.reviewers.map(name => agentLabels[name] || name).join(', ') })}</p>}
              {Array.isArray(review.blocked) && review.blocked.length > 0 && <p>{t('reviewHandoff.blocked', { agents: review.blocked.map(name => agentLabels[name] || name).join(', ') })}</p>}
            </div>}

            {/* Tap-to-ask chips (e.g. Yumi's seeded welcome). Only on the
                trailing message: once the user replies, the moment is over. */}
            {isLast && onSuggestion && Array.isArray(message.metadata?.suggestions) && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {(message.metadata.suggestions as string[]).slice(0, 4).map((s) => (
                  <button
                    key={s}
                    onClick={() => onSuggestion(s)}
                    className="rounded-full border border-primary/30 bg-primary/[0.04] px-3.5 py-2 text-[13px] font-medium text-primary hover:bg-primary/10 active:scale-[0.98] transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Action bar — revealed on hover, as in ChatGPT */}
            <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              {onReply && !approval && !message.messageId.startsWith('optimistic-') && <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => onReply(message)} aria-label={t('reactions.reply')}><Reply className="size-3" />{t('reactions.reply')}</Button>}
              <AgentSharingAction agentName={message.senderName} />
              <CopyMessageLink messageId={message.messageId} />
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleCopy}
                aria-label={t('chat.copyMessage')}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? t('common.copied') : t('common.copy')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ── v1.1 M6 — hand-off card ──────────────────────────────────────────────────
// Header "from → to", the request, collapsible Context / Output so far, and
// who owns the work next. Compact on purpose: it sits inline in the thread.

function HandoffCard({ handoff, agents, agentNames, agentLabels }: {
  handoff: HandoffRecord;
  agents: WorkspaceAgent[];
  agentNames: string[];
  agentLabels: Record<string, string>;
}) {
  const t = useT();
  const label = (name: string) => {
    const a = agents.find((x) => x.agentName === name);
    return a ? agentLabel(a) : name;
  };
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
      <div className="flex min-w-0 items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2">
        <ArrowRightLeft className="size-3.5 shrink-0 text-sky-500" />
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('collab.handoff.title')}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <AgentAvatar name={handoff.from} size={16} />
          <span className="truncate">{label(handoff.from)}</span>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
          <AgentAvatar name={handoff.to} size={16} />
          <span className="truncate">{label(handoff.to)}</span>
        </span>
      </div>
      <div className="space-y-2 px-3 py-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t('collab.handoff.request')}</p>
          <MarkdownContent content={handoff.request} agentNames={agentNames} agentLabels={agentLabels} />
        </div>
        {handoff.context && <HandoffSection title={t('collab.handoff.context')} body={handoff.context} />}
        {handoff.output && <HandoffSection title={t('collab.handoff.output')} body={handoff.output} />}
      </div>
      <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        <AgentAvatar name={handoff.nextOwner} size={14} />
        <span className="truncate">{t('collab.handoff.nextOwner', { owner: label(handoff.nextOwner) })}</span>
      </div>
    </div>
  );
}

function HandoffSection({ title, body }: { title: string; body: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {title}
        <span className="normal-case tracking-normal text-muted-foreground/70">· {open ? t('collab.handoff.hide') : t('collab.handoff.show')}</span>
      </button>
      {open && <div className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">{body}</div>}
    </div>
  );
}
