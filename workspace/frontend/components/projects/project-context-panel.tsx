'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Send, BookOpen, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProjectContextEntry, ContextQueryResult } from '@/lib/types';

interface ProjectContextPanelProps {
  projectId: string;
  projectName: string;
  contextEntries: ProjectContextEntry[];
  isOpen: boolean;
  onClose: () => void;
  onQuery: (question: string) => Promise<ContextQueryResult>;
}

export function ProjectContextPanel({
  projectId,
  projectName,
  contextEntries,
  isOpen,
  onClose,
  onQuery,
}: ProjectContextPanelProps) {
  const [query, setQuery] = useState('');
  const [isQuerying, setIsQuerying] = useState(false);
  const [lastResult, setLastResult] = useState<ContextQueryResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleQuery = async () => {
    if (!query.trim() || isQuerying) return;
    setIsQuerying(true);
    try {
      const result = await onQuery(query.trim());
      setLastResult(result);
      setQuery('');
    } catch (e) {
      console.error('Context query failed:', e);
    } finally {
      setIsQuerying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[380px] bg-card border-l border-border shadow-xl z-30 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-primary" />
          <span className="font-medium text-sm">{projectName} Context</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-md hover:bg-accent transition-colors">
          <X className="size-4 text-muted-foreground" />
        </button>
      </div>

      {/* Context Entries */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {contextEntries.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-8">
            No context entries yet.<br />
            Ask the context bot or add entries manually.
          </div>
        ) : (
          contextEntries.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-primary uppercase tracking-wide">
                  {entry.key}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {entry.contentType}
                </span>
              </div>
              <p className="text-xs text-foreground/80 line-clamp-4 whitespace-pre-wrap">
                {entry.content}
              </p>
            </div>
          ))
        )}

        {/* Query Result */}
        {lastResult && (
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 mt-4">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs font-medium text-primary">Answer</span>
              <span className="text-[10px] text-muted-foreground">
                via {lastResult.source === 'openclaw' ? 'OpenClaw' : 'local'}
              </span>
            </div>
            <p className="text-xs text-foreground whitespace-pre-wrap">
              {lastResult.answer}
            </p>
            {lastResult.contextKeysUsed.length > 0 && (
              <div className="mt-2 flex gap-1 flex-wrap">
                {lastResult.contextKeysUsed.map((key) => (
                  <span key={key} className="px-1.5 py-0.5 bg-primary/10 text-primary text-[10px] rounded">
                    {key}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Query Input */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder="Ask about project context..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleQuery();
            }}
            className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleQuery}
            disabled={!query.trim() || isQuerying}
            className={cn(
              'p-2 rounded-lg transition-colors',
              query.trim() && !isQuerying
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {isQuerying ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
