'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SendHorizontal, Paperclip, X, FileIcon, ImageIcon, Plus, CalendarClock } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { WorkspaceAgent } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';

export interface PendingFile {
  file: File;
  preview?: string; // data URL for images
}

interface ChatInputProps {
  onSend: (content: string, mentions: string[], files: PendingFile[]) => void;
  disabled?: boolean;
  className?: string;
  agents?: WorkspaceAgent[];
  draft?: string;
  onDraftChange?: (draft: string) => void;
  onFocusChange?: (focused: boolean) => void;
  /** Auto-focus the textarea when mounted or when this key changes. */
  focusKey?: number;
  onCreateRoutine?: () => void;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function ChatInput({ onSend, disabled, className, agents = [], draft, onDraftChange, onFocusChange, focusKey, onCreateRoutine }: ChatInputProps) {
  const [message, setMessage] = React.useState(draft ?? '');
  const [showMentions, setShowMentions] = React.useState(false);
  const [mentionFilter, setMentionFilter] = React.useState('');
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [pendingFiles, setPendingFiles] = React.useState<PendingFile[]>([]);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isFocused, setIsFocused] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const dragCountRef = React.useRef(0);

  // Sync message state when draft prop changes (thread switch)
  React.useEffect(() => {
    setMessage(draft ?? '');
    // Reset textarea height when switching threads
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [draft]);

  // Auto-focus textarea when focusKey changes (thread opened/switched)
  React.useEffect(() => {
    if (focusKey != null && textareaRef.current) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [focusKey]);

  const agentNames = agents.map((a) => a.agentName);

  // Extract @mentions from message text
  const extractMentions = (text: string): string[] => {
    const matches = text.match(/@([\w-]+)/g) || [];
    return matches
      .map((m) => m.slice(1))
      .filter((name) => agentNames.includes(name));
  };

  // Only suggest online agents — mentioning offline ones never resolves and
  // just clutters the picker on long-lived workspaces.
  const filteredAgents = agents.filter(
    (a) => a.status === 'online' && a.agentName.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  const addFiles = React.useCallback((files: FileList | File[]) => {
    const newFiles: PendingFile[] = [];
    for (const file of Array.from(files)) {
      if (isImageFile(file)) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setPendingFiles((prev) => prev.map((pf) =>
            pf.file === file ? { ...pf, preview: e.target?.result as string } : pf
          ));
        };
        reader.readAsDataURL(file);
      }
      newFiles.push({ file });
    }
    setPendingFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = (index: number) => {
    setPendingFiles((prev) => {
      const removed = prev[index];
      if (removed.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed && pendingFiles.length === 0) return;
    if (disabled) return;
    const mentions = extractMentions(trimmed);
    onSend(trimmed, mentions, pendingFiles);
    setMessage('');
    onDraftChange?.('');
    setPendingFiles([]);
    setShowMentions(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.blur();
    }
  };

  const insertMention = (agentName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBefore = message.slice(0, cursorPos);
    const textAfter = message.slice(cursorPos);

    // Find the @ that triggered the mention
    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex === -1) return;

    const newText = textBefore.slice(0, atIndex) + `@${agentName} ` + textAfter;
    setMessage(newText);
    onDraftChange?.(newText);
    setShowMentions(false);
    setMentionFilter('');

    // Restore focus
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = atIndex + agentName.length + 2;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ignore Enter during IME composition (Chinese, Japanese, Korean input)
    if (e.nativeEvent.isComposing || e.key === 'Process') return;

    if (showMentions && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % filteredAgents.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + filteredAgents.length) % filteredAgents.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredAgents[mentionIndex].agentName);
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

  // Auto-resize textarea + detect @mentions
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessage(value);
    onDraftChange?.(value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;

    // Detect @mention trigger
    const cursorPos = textarea.selectionStart;
    const textBefore = value.slice(0, cursorPos);
    const atMatch = textBefore.match(/@([\w-]*)$/);
    if (atMatch && agents.length > 1) {
      setMentionFilter(atMatch[1]);
      setMentionIndex(0);
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }
  };

  // Handle paste — detect images from clipboard
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }
  };

  // Drag-and-drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    setIsDragging(false);

    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = ''; // reset so same file can be selected again
    }
  };

  const hasContent = message.trim() || pendingFiles.length > 0;

  return (
    <div
      className={cn('relative', className)}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* @mention autocomplete dropdown */}
      {showMentions && filteredAgents.length > 0 && (
        <div className="absolute bottom-full mb-2 left-0 right-0 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden">
          {filteredAgents.map((agent, i) => (
              <button
                key={agent.agentName}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent transition-colors',
                  i === mentionIndex && 'bg-accent'
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(agent.agentName);
                }}
              >
                <AgentAvatar name={agent.agentName} size={24} status={agent.status} showStatus />
                <span className="font-medium">{agent.agentName}</span>
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full ml-auto',
                  agent.role === 'master'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                )}>
                  {agent.role}
                </span>
                <span className={cn(
                  'size-2 rounded-full',
                  agent.status === 'online' ? 'bg-green-500' : 'bg-zinc-400'
                )} />
              </button>
          ))}
        </div>
      )}

      <div className={cn(
        'relative flex flex-col gap-2 bg-background transition-all rounded-2xl border shadow-lg p-4',
        isDragging && 'border-primary border-dashed bg-primary/5',
        isFocused && !isDragging && 'ring-2 ring-primary/30 border-primary/40'
      )}>
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl z-10 pointer-events-none">
            <span className="text-sm font-medium text-primary">Drop files here</span>
          </div>
        )}

        {/* Pending file previews */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((pf, i) => (
              <div
                key={i}
                className="relative group rounded-lg border bg-muted overflow-hidden"
              >
                {pf.preview ? (
                  <img
                    src={pf.preview}
                    alt={pf.file.name}
                    className="h-20 w-auto max-w-[160px] object-cover"
                  />
                ) : (
                  <div className="h-20 w-24 flex flex-col items-center justify-center gap-1 px-2">
                    <FileIcon className="size-5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                      {pf.file.name}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => removeFile(i)}
                  className="absolute top-0.5 right-0.5 size-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => { setIsFocused(true); onFocusChange?.(true); }}
            onBlur={() => { setIsFocused(false); onFocusChange?.(false); }}
            placeholder={agents.length > 1 ? 'Message... (use @ to mention an agent)' : 'Message...'}
            rows={1}
            disabled={disabled}
            data-chat-input
            className="w-full border-0 bg-transparent shadow-none focus:outline-none placeholder:text-muted-foreground h-auto px-0 text-sm py-2 resize-none"
          />
          {/* Shortcut hint: always show 'esc' when focused, show 'i' when not focused and empty */}
          {isFocused ? (
            <kbd
              className="pointer-events-none absolute right-1 top-2.5 flex items-center justify-center rounded text-[9px] font-mono font-medium bg-muted text-muted-foreground border border-input h-4 px-1"
              title="Press Esc to exit typing mode"
            >
              esc
            </kbd>
          ) : !message && (
            <kbd
              className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center rounded text-[9px] font-mono font-medium bg-muted text-muted-foreground border border-input size-4"
              title="Press any key to start typing"
            >
              i
            </kbd>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.json,.csv,.xml,.html,.css,.js,.ts,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.hpp,.sh,.yaml,.yml,.toml"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Attach file"
            >
              <Paperclip className="size-4" />
            </button>
            <button
              onClick={() => {
                // Open file input in image-only mode
                if (fileInputRef.current) {
                  fileInputRef.current.accept = 'image/*';
                  fileInputRef.current.click();
                  // Reset to full accept list
                  setTimeout(() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.accept = "image/*,.pdf,.txt,.md,.json,.csv,.xml,.html,.css,.js,.ts,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.hpp,.sh,.yaml,.yml,.toml";
                    }
                  }, 100);
                }
              }}
              className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Attach image"
            >
              <ImageIcon className="size-4" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="More actions"
                >
                  <Plus className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="min-w-[180px]">
                <DropdownMenuItem onSelect={() => onCreateRoutine?.()}>
                  <CalendarClock className="size-4 mr-2" />
                  Create Routine
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button
            variant={hasContent ? 'primary' : 'secondary'}
            size="icon"
            className={cn(
              'size-9 rounded-xl transition-all',
              hasContent ? 'opacity-100' : 'opacity-50'
            )}
            onClick={handleSend}
            disabled={!hasContent || disabled}
          >
            <SendHorizontal className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
