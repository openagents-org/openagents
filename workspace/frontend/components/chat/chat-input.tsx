'use client';

import * as React from 'react';
import { ArrowUp } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import type { WorkspaceAgent, KnowledgeEntry } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { extractMentionedAgents, extractMentionedHumans } from '@/lib/people-mentions';
import { humanMentionDisplay, editHumanMentionDraft, updateHumanMentionDraft } from './composer-human-mentions';
import { ComposerAddMenu } from './composer-add-menu';
import { ComposerAttachments } from './composer-attachments';
import { ComposerMentionMenu } from './composer-mention-menu';
import { FILE_ACCEPT, useComposerFiles, type PendingFile } from './use-composer-files';
import { useComposerMentions, type MentionItem } from './use-composer-mentions';

export type { PendingFile } from './use-composer-files';

const MAX_TEXTAREA_HEIGHT = 200;

interface ChatInputProps {
  conversationId: string | null;
  /** `mentionedHumans` — emails of roster people @mentioned in the text. */
  onSend: (content: string, mentions: string[], files: PendingFile[], mentionedHumans?: string[]) => void;
  disabled?: boolean;
  className?: string;
  agents?: WorkspaceAgent[];
  knowledge?: KnowledgeEntry[];
  draft?: string;
  onDraftChange?: (draft: string) => void;
  onFocusChange?: (focused: boolean) => void;
  /** Auto-focus the textarea when mounted or when this key changes. */
  focusKey?: number;
  onCreateRoutine?: () => void;
  /** v1.1 M5 — one-line note above the input (e.g. "you're adding information"). */
  hint?: string | null;
}

export function ChatInput({ conversationId, onSend, disabled, className, agents = [], knowledge = [], draft, onDraftChange, onFocusChange, focusKey, onCreateRoutine, hint }: ChatInputProps) {
  const t = useT();
  const [message, setMessage] = React.useState(draft ?? '');
  const [showMentions, setShowMentions] = React.useState(false);
  const [mentionFilter, setMentionFilter] = React.useState('');
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [isFocused, setIsFocused] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const files = useComposerFiles();
  const mentions = useComposerMentions({ conversationId, agents, knowledge, mentionFilter, showMentions });
  const { mentionPeople, mentionItems } = mentions;
  const displayMessage = humanMentionDisplay(message, mentionPeople).text;

  // Auto-size the textarea to its content (capped), toggling a scrollbar past
  // the cap. Centralized here so every path that changes `message` — typing,
  // mention insert, draft restore on thread switch, send-clear — resizes
  // consistently.
  const resizeTextarea = React.useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const capped = Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT);
    ta.style.height = `${capped}px`;
    ta.style.overflowY = ta.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
  }, []);

  // Sync message state when draft prop changes (thread switch). Note: the draft
  // is controlled and round-trips on every keystroke, so this must NOT reset the
  // height itself — otherwise the box collapses to one row while typing. The
  // layout effect below handles sizing off `message`.
  React.useEffect(() => {
    setMessage(draft ?? '');
  }, [draft]);

  // Keep the textarea sized to its content whenever the message changes.
  // useLayoutEffect runs synchronously before paint, so there's no flicker.
  React.useLayoutEffect(() => {
    resizeTextarea();
  }, [displayMessage, resizeTextarea]);

  // Auto-focus textarea when focusKey changes (thread opened/switched)
  React.useEffect(() => {
    if (focusKey != null && textareaRef.current) {
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      });
    }
  }, [focusKey]);

  const agentNames = agents.map((a) => a.agentName);
  const hasContent = !!message.trim() || files.pendingFiles.length > 0;
  const canSend = hasContent && !disabled;

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed && files.pendingFiles.length === 0) return;
    if (disabled) return;
    const mentioned = extractMentionedAgents(trimmed, agentNames);
    const mentionedHumans = extractMentionedHumans(trimmed, mentions.participantEmails, mentions.selfEmail);
    onSend(trimmed, mentioned, files.pendingFiles, mentionedHumans);
    setMessage('');
    onDraftChange?.('');
    files.clearFiles();
    setShowMentions(false);
    // Height resets via the layout effect when `message` becomes ''.
    textareaRef.current?.blur();
  };

  const insertMention = (mentionText: string, displayName = mentionText) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBefore = displayMessage.slice(0, cursorPos);

    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex === -1) return;

    const newText = editHumanMentionDraft(message, mentionPeople, atIndex, cursorPos, `@${mentionText} `);
    setMessage(newText);
    onDraftChange?.(newText);
    setShowMentions(false);
    setMentionFilter('');

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = atIndex + displayName.length + 2;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const insertMentionItem = (item: MentionItem) => {
    if (item.type === 'all') {
      insertMention('all');
    } else if (item.type === 'agent') {
      insertMention(item.agent.agentName);
    } else if (item.type === 'person') {
      insertMention(item.person.email, item.person.name);
    } else {
      insertMention(`knowledge:${item.entry.slug}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ignore Enter during IME composition (Chinese, Japanese, Korean input)
    if (e.nativeEvent.isComposing || e.key === 'Process') return;

    if (showMentions && mentionItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % mentionItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + mentionItems.length) % mentionItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMentionItem(mentionItems[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setShowMentions(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    // Escape blurs the textarea so global shortcuts (1-9, i, etc.) work again.
    if (e.key === 'Escape') {
      e.preventDefault();
      textareaRef.current?.blur();
    }
  };

  // Track the draft (height follows via the layout effect) and detect @mentions.
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const nextDraft = updateHumanMentionDraft(message, value, mentionPeople, e.target.selectionStart);
    setMessage(nextDraft);
    onDraftChange?.(nextDraft);

    const textBefore = value.slice(0, e.target.selectionStart);
    // [^\s@] (not \w) so typing a display name like "@小明" keeps the
    // picker open while filtering; the inserted mention is still ASCII.
    const atMatch = textBefore.match(/@([^\s@]*)$/);
    if (atMatch && (agents.length > 1 || knowledge.length > 0 || mentions.team.length > 0)) {
      setMentionFilter(atMatch[1]);
      setMentionIndex(0);
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }
  };

  const canMention = agents.length > 1 || knowledge.length > 0 || mentions.team.length > 0;

  return (
    <div className={cn('relative', className)} {...files.dragHandlers}>
      {showMentions && mentionItems.length > 0 && (
        <ComposerMentionMenu
          offerAll={mentions.offerAll}
          people={mentions.filteredPeople}
          agents={mentions.filteredAgents}
          knowledge={mentions.filteredKnowledge}
          sessions={mentions.sessions}
          activeIndex={mentionIndex}
          availabilityOf={mentions.availabilityOf}
          onPick={insertMentionItem}
        />
      )}

      <input
        ref={files.fileInputRef}
        type="file"
        multiple
        accept={FILE_ACCEPT}
        onChange={files.handleFileSelect}
        className="hidden"
      />

      {/* shadcn AI Elements Prompt Input: the hint and queued files on top,
          the growing textarea, then a toolbar row with the `+` menu on the
          left and the round send button on the right. */}
      <InputGroup
        data-dragging={files.isDragging || undefined}
        className="bg-background data-dragging:border-dashed data-dragging:border-primary data-dragging:bg-primary/5"
      >
        {files.isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg">
            <span className="text-sm font-medium text-primary">{t('chatInput.dropFilesHere')}</span>
          </div>
        )}
        {hint && (
          <InputGroupAddon align="block-start" className="text-xs font-normal" data-composer-hint>
            {hint}
          </InputGroupAddon>
        )}
        {files.pendingFiles.length > 0 && (
          <InputGroupAddon align="block-start" className="cursor-default select-auto">
            <ComposerAttachments files={files.pendingFiles} onRemove={files.removeFile} />
          </InputGroupAddon>
        )}

        <InputGroupTextarea
          ref={textareaRef}
          value={displayMessage}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={files.handlePaste}
          onFocus={() => { setIsFocused(true); onFocusChange?.(true); }}
          onBlur={() => { setIsFocused(false); onFocusChange?.(false); }}
          placeholder={canMention ? t('chatInput.placeholderWithMentions') : t('chatInput.placeholder')}
          rows={1}
          disabled={disabled}
          data-chat-input
          className="min-h-0 p-3"
        />

        <InputGroupAddon align="block-end">
          <ComposerAddMenu onPickFile={files.openFilePicker} onCreateRoutine={onCreateRoutine} />

          <div className="ml-auto flex items-center gap-2">
            {/* Keyboard affordance for the global 'type anywhere' shortcut */}
            {isFocused ? (
              <Kbd className="hidden sm:inline-flex" title={t('chatInput.escHint')}>esc</Kbd>
            ) : !message ? (
              <Kbd className="hidden sm:inline-flex" title={t('chatInput.typeHint')}>i</Kbd>
            ) : null}

            {/* aria-disabled rather than disabled: a disabled control inside the
                InputGroup dims the whole composer (has-disabled). */}
            <InputGroupButton
              variant="default"
              size="icon-sm"
              className="rounded-full aria-disabled:pointer-events-none aria-disabled:opacity-50"
              onClick={handleSend}
              aria-disabled={!canSend}
              aria-label={t('chatInput.sendMessage')}
            >
              <ArrowUp />
            </InputGroupButton>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
