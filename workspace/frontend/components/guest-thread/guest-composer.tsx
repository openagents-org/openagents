'use client';

import * as React from 'react';
import { ArrowUp, AtSign } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { Toggle } from '@/components/ui/toggle';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { GuestThreadAgent } from '@/lib/guest-thread-api';
import { agentDisplayName, startsWithMention, willRunAgent } from '@/lib/guest-thread';

const MAX_TEXTAREA_HEIGHT = 200;

interface GuestComposerProps {
  agents: GuestThreadAgent[];
  /** Agent the next message asks, or null for a plain comment. */
  askAgent: string | null;
  onAskAgentChange: (agentName: string | null) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  className?: string;
}

/**
 * The workspace prompt input (same InputGroup layout as ChatInput) with one
 * guest-specific control: an "Ask <agent>" chip. The thread is passive, so a
 * message only runs the agent when it starts with `@<agent>`; the chip adds
 * that prefix, and the placeholder/hint say which of the two will happen.
 */
export function GuestComposer({ agents, askAgent, onAskAgentChange, draft, onDraftChange, onSubmit, className }: GuestComposerProps) {
  const t = useT();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const target = agents.find((a) => a.name === askAgent) ?? null;
  const runsAgent = willRunAgent(draft, !!target, target?.name ?? null, agents);
  // Who the hint names: the chip's agent, else one the guest @mentioned.
  const hintAgent = target ?? agents.find((a) => startsWithMention(draft, a.name)) ?? agents[0] ?? null;
  const canSend = draft.trim().length > 0;

  React.useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    ta.style.overflowY = ta.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
  }, [draft]);

  const submit = () => {
    if (!canSend) return;
    onSubmit();
    textareaRef.current?.focus();
  };

  const placeholder = target
    ? t('guestThread.placeholderAsk', { agent: agentDisplayName(target) })
    : t('guestThread.placeholderComment');

  return (
    <div className={cn('relative', className)}>
      <InputGroup className="bg-background">
        {canSend && hintAgent && (
          <InputGroupAddon align="block-start" className="text-xs font-normal" data-composer-hint>
            {runsAgent
              ? t('guestThread.askAgentHint', { agent: agentDisplayName(hintAgent) })
              : t('guestThread.commentHint', { agent: agentDisplayName(hintAgent) })}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          rows={1}
          className="min-h-0 p-3"
          data-chat-input
        />
        <InputGroupAddon align="block-end">
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto no-scrollbar">
            {agents.map((agent) => (
              <Toggle
                key={agent.name}
                variant="outline"
                size="sm"
                pressed={askAgent === agent.name}
                onPressedChange={(pressed) => onAskAgentChange(pressed ? agent.name : null)}
                className="shrink-0 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
              >
                <AtSign data-icon="inline-start" />
                {t('guestThread.askAgent', { agent: agentDisplayName(agent) })}
              </Toggle>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
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
