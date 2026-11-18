'use client';

import { useState } from 'react';
import { Check, Copy, Reply } from 'lucide-react';
import { toast } from 'sonner';
import type { ApprovalRequest, WorkspaceAgent, WorkspaceMessage } from '@/lib/types';
import type { HandoffRecord } from '@/lib/handoff';
import { useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { MessageArtifacts } from '@/components/artifacts/message-artifacts';
import { Button } from '@/components/ui/button';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageAvatar, MessageContent, MessageHeader } from '@/components/ui/message';
import { AgentOwnershipBadge, AgentSharingAction } from './agent-message-access';
import { ApprovalCard } from './approval-card';
import { CopyMessageLink } from './copy-message-link';
import { HandoffCard } from './handoff-card';
import { MarkdownContent } from './markdown-content';
import { MessageAttachments, type MessageAttachment } from './message-attachments';
import { CompletionAudience } from './message-audience';
import { ReplyCitation, type ReplyCitationData } from './reply-citation';
import { YumiAgentLocation } from './yumi-agent-location';
import { messageModel } from './message-model';

export interface AgentMessageRowProps {
  message: WorkspaceMessage;
  agents: WorkspaceAgent[];
  agent?: WorkspaceAgent;
  agentNames: string[];
  agentLabels: Record<string, string>;
  humanNames: Record<string, string>;
  selfMention?: string;
  timestamp: string | null;
  attachments: MessageAttachment[];
  approval: ApprovalRequest | null;
  handoff: HandoffRecord | null;
  displayContent: string;
  yumiWelcome: boolean;
  isLast: boolean;
  onSuggestion?: (text: string) => void;
  onReply?: (message: WorkspaceMessage) => void;
}

// Full-bleed, no bubble — ChatGPT's assistant turn. The avatar and name stay:
// a thread can have several agents, so the author still has to be readable.
export function AgentMessageRow({ message, agents, agent, agentNames, agentLabels, humanNames, selfMention, timestamp, attachments, approval, handoff, displayContent, yumiWelcome, isLast, onSuggestion, onReply }: AgentMessageRowProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const review = message.metadata?.review_handoff as { reviewers?: string[]; blocked?: string[] } | undefined;
  const attachedIds = attachments.map(item => item.fileId);
  const suggestions = isLast && !yumiWelcome && onSuggestion && Array.isArray(message.metadata?.suggestions)
    ? (message.metadata.suggestions as string[]).slice(0, 4) : [];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('chat.copyFailed'));
    }
  };

  return (
    <Message className="gap-3 py-2">
      <MessageAvatar className="self-start">
        <AgentAvatar name={message.senderName} size={32} />
      </MessageAvatar>
      <MessageContent className="gap-0.5">
        <MessageHeader className="flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="truncate text-sm font-semibold text-foreground">
            {agent ? agentLabel(agent) : message.senderName}
          </span>
          {agent && <AgentOwnershipBadge agent={agent} model={messageModel(message, agent)} />}
          {timestamp && <span className="font-normal">{timestamp}</span>}
        </MessageHeader>
        <Bubble variant="ghost" className="w-full">
          <BubbleContent className="w-full overflow-visible">
            {approval ? (
              <ApprovalCard approval={approval} />
            ) : handoff ? (
              <>
                <HandoffCard handoff={handoff} agents={agents} agentNames={agentNames} agentLabels={agentLabels} />
                <MessageAttachments items={attachments} senderAgentName={message.senderName} />
                <MessageArtifacts content={message.content} attachedIds={attachedIds} />
              </>
            ) : (
              <>
                <ReplyCitation citation={message.metadata.reply_to as ReplyCitationData | undefined} />
                <MarkdownContent content={displayContent} agentNames={agentNames} agentLabels={agentLabels} humanNames={humanNames} selfMention={selfMention} />
                <MessageAttachments items={attachments} senderAgentName={message.senderName} />
                <MessageArtifacts content={message.content} attachedIds={attachedIds} />
              </>
            )}

            {!approval && <CompletionAudience message={message} agents={agents} />}

            {review && <div className="mt-2 text-xs text-muted-foreground" role="status">
              {Array.isArray(review.reviewers) && review.reviewers.length > 0 && <p>{t('reviewHandoff.sent', { agents: review.reviewers.map(name => agentLabels[name] || name).join(', ') })}</p>}
              {Array.isArray(review.blocked) && review.blocked.length > 0 && <p>{t('reviewHandoff.blocked', { agents: review.blocked.map(name => agentLabels[name] || name).join(', ') })}</p>}
            </div>}

            {/* Tap-to-ask chips (e.g. Yumi's seeded welcome), as shadcn AI
                Elements Suggestion: one row that scrolls sideways. Only on the
                trailing message: once the user replies, the moment is over. */}
            {isLast && yumiWelcome && <YumiAgentLocation />}
            {suggestions.length > 0 && (
              <div className="mt-2.5 flex scroll-fade-x no-scrollbar gap-2 overflow-x-auto overscroll-x-contain">
                {suggestions.map((s) => (
                  <Button key={s} variant="outline" size="sm" className="shrink-0" onClick={() => onSuggestion?.(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            )}

            {/* Action bar — revealed on hover, as in ChatGPT */}
            <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              {onReply && !approval && !message.messageId.startsWith('optimistic-') && (
                <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onReply(message)} aria-label={t('reactions.reply')}>
                  <Reply data-icon="inline-start" />{t('reactions.reply')}
                </Button>
              )}
              <AgentSharingAction agentName={message.senderName} />
              <CopyMessageLink messageId={message.messageId} />
              <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={handleCopy} aria-label={t('chat.copyMessage')}>
                {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                {copied ? t('common.copied') : t('common.copy')}
              </Button>
            </div>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}
