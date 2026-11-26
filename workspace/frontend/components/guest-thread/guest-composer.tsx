'use client';

import * as React from 'react';
import { ArrowUp } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { ComposerMentionMenu } from '@/components/chat/composer-mention-menu';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { Toggle } from '@/components/ui/toggle';
import { getAgentColor } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WorkspaceAgent } from '@/lib/types';
import type { GuestThreadAgent } from '@/lib/guest-thread-api';
import { agentDisplayName, mentionsAgent, toWorkspaceAgents, willRunAgent } from '@/lib/guest-thread';

const MAX_TEXTAREA_HEIGHT = 200;

interface GuestComposerProps {
  agents: GuestThreadAgent[];
  /** Agent the next message asks, or null for a plain comment. */
  askAgent: string | null;
  onAskAgentChange: (agentName: string | null) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  /** Requests to the agent wait for this person's approval (null: they run right away). */
  approvalOwner?: string | null;
  /** The owner doesn't let guests ask the agent: why (the chip is off and inert, `@` offers nobody). */
  askBlocked?: string | null;
  className?: string;
}

/** The `@word` being typed right before the caret, if any. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = text.slice(0, caret).match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  return { start: caret - match[2].length - 1, query: match[2] };
}

/** Thread agents matching a typed `@query` by name or label. */
export function matchingAgents(agents: WorkspaceAgent[], query: string): WorkspaceAgent[] {
  const q = query.toLowerCase();
  return agents.filter((a) => a.agentName.toLowerCase().startsWith(q)
    || (a.displayName || '').toLowerCase().split(/\s+/).some((word) => word.startsWith(q))
    || (a.displayName || '').toLowerCase().startsWith(q));
}

/**
 * The workspace prompt input (ChatInput's InputGroup layout, @ picker and
 * keys) with one guest-specific control: an "Ask <agent>" chip. The thread is
 * passive, so a message only runs the agent when it starts with `@<agent>`;
 * the chip adds that prefix, and the placeholder/hint say which will happen.
 */
export function GuestComposer({ agents, askAgent, onAskAgentChange, draft, onDraftChange, onSubmit, approvalOwner = null, askBlocked = null, className }: GuestComposerProps) {
  const t = useT();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const workspaceAgents = React.useMemo(() => toWorkspaceAgents(agents), [agents]);
  const agentNames = React.useMemo(() => agents.map((a) => a.name), [agents]);
  const [mention, setMention] = React.useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const target = agents.find((a) => a.name === askAgent) ?? null;
  const runsAgent = !askBlocked && willRunAgent(draft, !!target, target?.name ?? null, agents);
  // Who the hint names: the chip's agent, else one the guest @mentioned.
  const hintAgent = target ?? agents.find((a) => mentionsAgent(draft, a.name)) ?? agents[0] ?? null;
  const canSend = draft.trim().length > 0;
  const options = mention && !askBlocked ? matchingAgents(workspaceAgents, mention.query) : [];
  const pickerOpen = options.length > 0;

  React.useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    ta.style.overflowY = ta.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
  }, [draft]);

  // A draft cleared from outside (sent) closes the picker.
  React.useEffect(() => { if (!draft) setMention(null); }, [draft]);

  const submit = () => {
    if (!canSend) return;
    setMention(null);
    onSubmit();
    textareaRef.current?.focus();
  };

  const pick = (agent: WorkspaceAgent) => {
    if (!mention) return;
    const ta = textareaRef.current;
    const caret = ta?.selectionStart ?? mention.start + mention.query.length + 1;
    const inserted = `@${agent.agentName} `;
    const next = draft.slice(0, mention.start) + inserted + draft.slice(caret);
    onDraftChange(next);
    setMention(null);
    const pos = mention.start + inserted.length;
    setTimeout(() => {
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  const placeholder = askBlocked
    ? t('guestThread.placeholderComment')
    : target
    ? t('guestThread.placeholderAsk', { agent: agentDisplayName(target) })
    : agents[0]
      ? t('guestThread.placeholderMention', { agent: agentDisplayName(agents[0]) })
      : t('guestThread.placeholderComment');

  return (
    <div className={cn('relative', className)}>
      {pickerOpen && (
        <ComposerMentionMenu
          offerAll={false}
          people={[]}
          agents={options}
          knowledge={[]}
          sessions={[]}
          activeIndex={Math.min(mentionIndex, options.length - 1)}
          availabilityOf={(agent) => (agent.status === 'online' ? 'online' : 'offline')}
          onPick={(item) => { if (item.type === 'agent') pick(item.agent); }}
        />
      )}
      <InputGroup className="bg-background">
        {canSend && hintAgent && (
          <InputGroupAddon align="block-start" className="text-xs font-normal" data-composer-hint>
            {runsAgent && approvalOwner
              ? t('guestThread.askAgentHintApproval', { agent: agentDisplayName(hintAgent), owner: approvalOwner })
              : runsAgent
              ? t('guestThread.askAgentHint', { agent: agentDisplayName(hintAgent) })
              : t('guestThread.commentHint', { agent: agentDisplayName(hintAgent) })}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            onDraftChange(e.target.value);
            const next = mentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
            setMention(next);
            setMentionIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.key === 'Process') return;
            if (pickerOpen) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => (i + 1) % options.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((i) => (i - 1 + options.length) % options.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(options[Math.min(mentionIndex, options.length - 1)]); return; }
              if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onBlur={() => setMention(null)}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-expanded={pickerOpen}
          aria-autocomplete="list"
          rows={1}
          className="min-h-0 p-3"
          data-chat-input
        />
        <InputGroupAddon align="block-end">
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto no-scrollbar">
            {agents.map((agent) => {
              const pressed = !askBlocked && askAgent === agent.name;
              const color = getAgentColor(agent.name, agentNames);
              return (
                <Toggle
                  key={agent.name}
                  variant="outline"
                  size="sm"
                  pressed={pressed}
                  onPressedChange={(on) => { if (!askBlocked) onAskAgentChange(on ? agent.name : null); }}
                  // aria-disabled, not disabled: a disabled control dims the whole InputGroup.
                  aria-disabled={askBlocked ? true : undefined}
                  data-ask-blocked={askBlocked ? '' : undefined}
                  title={askBlocked || (pressed ? t('guestThread.askAgentHint', { agent: agentDisplayName(agent) }) : t('guestThread.commentHint', { agent: agentDisplayName(agent) }))}
                  className={cn(
                    'h-8 shrink-0 gap-1.5 rounded-full ps-1 pe-3 font-normal text-muted-foreground',
                    'data-[state=on]:font-medium',
                    askBlocked && 'cursor-not-allowed opacity-60 hover:bg-transparent',
                    pressed && cn(color.bg, color.text, color.border),
                  )}
                >
                  <AgentAvatar name={agent.name} size={22} className={cn('[&_svg]:size-full!', !pressed && 'opacity-60 grayscale')} />
                  {t('guestThread.askAgent', { agent: agentDisplayName(agent) })}
                </Toggle>
              );
            })}
            {askBlocked && <span className="hidden min-w-0 self-center truncate text-xs text-muted-foreground sm:inline" data-ask-blocked-note="">{askBlocked}</span>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* aria-disabled rather than disabled: a disabled control inside the
                InputGroup dims the whole composer (has-disabled). */}
            <InputGroupButton
              variant="default"
              size="icon-sm"
              className="rounded-full aria-disabled:pointer-events-none aria-disabled:opacity-50"
              onClick={submit}
              aria-disabled={!canSend}
              aria-label={t('guestThread.send')}
            >
              <ArrowUp />
            </InputGroupButton>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
