'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SendHorizontal, Paperclip, X, FileIcon, ImageIcon, Plus, CalendarClock, ListTodo, BookOpen, Eye } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { WorkspaceAgent, KnowledgeEntry } from '@/lib/types';
import { createTask } from '@/lib/api-tasks';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { BookOpen as BookOpenMention } from 'lucide-react';

export interface PendingFile {
  file: File;
  preview?: string; // data URL for images
}

interface ChatInputProps {
  onSend: (content: string, mentions: string[], files: PendingFile[], metadata?: Record<string, unknown>) => void;
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
  workspaceId?: string;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function ChatInput({ onSend, disabled, className, agents = [], knowledge = [], draft, onDraftChange, onFocusChange, focusKey, onCreateRoutine, workspaceId }: ChatInputProps) {
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

  // Slash command state
  const [slashMenuOpen, setSlashMenuOpen] = React.useState(false);
  const [slashMenuIndex, setSlashMenuIndex] = React.useState(0);
  const [slashCommand, setSlashCommand] = React.useState<string | null>(null);
  // Inline task form state
  const [taskFormTitle, setTaskFormTitle] = React.useState('');
  const [taskFormPriority, setTaskFormPriority] = React.useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [taskFormAssignee, setTaskFormAssignee] = React.useState('');

  const SLASH_COMMANDS = [
    { command: '/task', label: '创建任务', icon: ListTodo },
    { command: '/knowledge', label: '添加知识', icon: BookOpen },
    { command: '/routine', label: '创建定时任务', icon: CalendarClock },
    { command: '/review', label: '请求 Review', icon: Eye },
  ];

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

  const filteredKnowledge = knowledge.filter(
    (k) => k.title.toLowerCase().includes(mentionFilter.toLowerCase()) ||
           k.slug.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  type MentionItem =
    | { type: 'agent'; agent: WorkspaceAgent }
    | { type: 'knowledge'; entry: KnowledgeEntry };

  const mentionItems: MentionItem[] = [
    ...filteredAgents.map((agent): MentionItem => ({ type: 'agent', agent })),
    ...filteredKnowledge.map((entry): MentionItem => ({ type: 'knowledge', entry })),
  ];

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
    setSlashCommand(null);
    setSlashMenuOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.blur();
    }
  };

  const handleTaskFormSubmit = async () => {
    if (!taskFormTitle.trim()) return;
    const task = await createTask({
      workspaceId: workspaceId || 'ws-1',
      title: taskFormTitle.trim(),
      priority: taskFormPriority,
      assignee: taskFormAssignee.trim() || null,
      taskType: 'human',
      assigneeType: taskFormAssignee.trim() ? 'human' : 'human',
    });
    const metadata = {
      actionType: 'task_created',
      task: {
        id: task.id,
        title: task.title,
        priority: task.priority,
        status: task.status,
        assignee: task.assignee,
      },
    };
    onSend(`/task ${taskFormTitle.trim()}`, [], [], metadata);
    setMessage('');
    onDraftChange?.('');
    setSlashCommand(null);
    setTaskFormTitle('');
    setTaskFormPriority('medium');
    setTaskFormAssignee('');
  };

  const handleSlashCancel = () => {
    setSlashCommand(null);
    setSlashMenuOpen(false);
    setMessage('');
    onDraftChange?.('');
    textareaRef.current?.focus();
  };

  const insertMention = (mentionText: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBefore = message.slice(0, cursorPos);
    const textAfter = message.slice(cursorPos);

    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex === -1) return;

    const newText = textBefore.slice(0, atIndex) + `@${mentionText} ` + textAfter;
    setMessage(newText);
    onDraftChange?.(newText);
    setShowMentions(false);
    setMentionFilter('');

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = atIndex + mentionText.length + 2;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const insertMentionItem = (item: MentionItem) => {
    if (item.type === 'agent') {
      insertMention(item.agent.agentName);
    } else {
      insertMention(`knowledge:${item.entry.slug}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ignore Enter during IME composition (Chinese, Japanese, Korean input)
    if (e.nativeEvent.isComposing || e.key === 'Process') return;

    // Slash command menu navigation
    if (slashMenuOpen && SLASH_COMMANDS.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashMenuIndex((prev) => (prev + 1) % SLASH_COMMANDS.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashMenuIndex((prev) => (prev - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = SLASH_COMMANDS[slashMenuIndex];
        setSlashCommand(selected.command);
        setMessage(selected.command + ' ');
        onDraftChange?.(selected.command + ' ');
        setSlashMenuOpen(false);
        if (selected.command === '/task') {
          // Will show inline form
          setTaskFormTitle('');
          setTaskFormPriority('medium');
          setTaskFormAssignee('');
        }
        return;
      }
      if (e.key === 'Escape') {
        setSlashMenuOpen(false);
        return;
      }
    }

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
    const atMatch = textBefore.match(/@([\w:-]*)$/);
    if (atMatch && (agents.length > 1 || knowledge.length > 0)) {
      setMentionFilter(atMatch[1]);
      setMentionIndex(0);
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }

    // Detect slash command trigger (only at start of input)
    if (value.startsWith('/') && !slashCommand) {
      const slashMatch = value.match(/^\/(\w*)$/);
      if (slashMatch) {
        setSlashMenuOpen(true);
        setSlashMenuIndex(0);
      } else {
        setSlashMenuOpen(false);
      }
    } else if (!value.startsWith('/')) {
      setSlashMenuOpen(false);
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
      {showMentions && mentionItems.length > 0 && (
        <div className="absolute bottom-full mb-2 left-0 right-0 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden max-h-[280px] overflow-y-auto">
          {filteredAgents.length > 0 && filteredKnowledge.length > 0 && (
            <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border">Agents</div>
          )}
          {filteredAgents.map((agent) => {
            const idx = mentionItems.findIndex((m) => m.type === 'agent' && m.agent.agentName === agent.agentName);
            return (
              <button
                key={agent.agentName}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent transition-colors',
                  idx === mentionIndex && 'bg-accent'
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
            );
          })}
          {filteredKnowledge.length > 0 && (
            <>
              {filteredAgents.length > 0 && (
                <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-t border-border">Knowledge</div>
              )}
              {filteredKnowledge.map((entry) => {
                const idx = mentionItems.findIndex((m) => m.type === 'knowledge' && m.entry.id === entry.id);
                return (
                  <button
                    key={entry.id}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent transition-colors',
                      idx === mentionIndex && 'bg-accent'
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(`knowledge:${entry.slug}`);
                    }}
                  >
                    <div className="size-6 rounded-md bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                      <BookOpenMention className="size-3.5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <span className="font-medium truncate">{entry.title}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto font-mono shrink-0">@knowledge:{entry.slug}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Slash command menu */}
      {slashMenuOpen && (
        <div className="absolute bottom-full mb-2 left-0 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden w-56">
          <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border">
            命令
          </div>
          {SLASH_COMMANDS.map((cmd, idx) => {
            const Icon = cmd.icon;
            return (
              <button
                key={cmd.command}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent transition-colors',
                  idx === slashMenuIndex && 'bg-accent'
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSlashCommand(cmd.command);
                  setMessage(cmd.command + ' ');
                  onDraftChange?.(cmd.command + ' ');
                  setSlashMenuOpen(false);
                  if (cmd.command === '/task') {
                    setTaskFormTitle('');
                    setTaskFormPriority('medium');
                    setTaskFormAssignee('');
                  }
                }}
              >
                <Icon className="size-4 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">{cmd.command}</span>
                <span className="text-xs ml-auto text-muted-foreground">{cmd.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className={cn(
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

        {/* Inline task form (shown when /task command is selected) */}
        {slashCommand === '/task' && (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
              <ListTodo className="size-3.5" />
              <span>创建任务</span>
              <button
                onClick={handleSlashCancel}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <input
              type="text"
              placeholder="任务标题（必填）"
              value={taskFormTitle}
              onChange={(e) => setTaskFormTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleTaskFormSubmit();
                }
                if (e.key === 'Escape') {
                  handleSlashCancel();
                }
              }}
              autoFocus
              className="w-full text-sm bg-background border rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <div className="flex items-center gap-2">
              <select
                value={taskFormPriority}
                onChange={(e) => setTaskFormPriority(e.target.value as typeof taskFormPriority)}
                className="text-xs bg-background border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="low">低优先级</option>
                <option value="medium">中优先级</option>
                <option value="high">高优先级</option>
                <option value="urgent">紧急</option>
              </select>
              <input
                type="text"
                placeholder="分配给（可选）"
                value={taskFormAssignee}
                onChange={(e) => setTaskFormAssignee(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleTaskFormSubmit();
                  }
                }}
                className="flex-1 text-xs bg-background border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <Button
                variant="primary"
                size="sm"
                className="h-7 text-xs px-3"
                onClick={handleTaskFormSubmit}
                disabled={!taskFormTitle.trim()}
              >
                创建
              </Button>
            </div>
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
            placeholder={agents.length > 1 || knowledge.length > 0 ? 'Message... (use @ to mention agents or knowledge)' : 'Message...'}
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
