'use client';

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Check, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Task, TaskAnnotation } from '@/lib/api-tasks';
import { addAnnotation, resolveAnnotation } from '@/lib/api-tasks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskReviewPanelProps {
  task: Task;
  onTaskUpdate?: (task: Task) => void;
  currentUser?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskReviewPanel({ task, onTaskUpdate, currentUser = 'You' }: TaskReviewPanelProps) {
  const [newAnnotation, setNewAnnotation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const agentResult = task.agentResult as Record<string, unknown> | null;
  const summary = agentResult?.summary as string | undefined;
  const annotations = (agentResult?.annotations as TaskAnnotation[]) || [];

  const handleAddAnnotation = useCallback(async () => {
    if (!newAnnotation.trim() || submitting) return;
    setSubmitting(true);
    try {
      const updatedTask = await addAnnotation(task.id, {
        content: newAnnotation.trim(),
        author: currentUser,
      });
      onTaskUpdate?.(updatedTask);
      setNewAnnotation('');
    } finally {
      setSubmitting(false);
    }
  }, [newAnnotation, submitting, task.id, currentUser, onTaskUpdate]);

  const handleResolve = useCallback(async (annotationId: string) => {
    const updatedTask = await resolveAnnotation(task.id, annotationId);
    onTaskUpdate?.(updatedTask);
  }, [task.id, onTaskUpdate]);

  return (
    <div className="border-t border-border bg-muted/20 px-3 py-3 space-y-3">
      {/* Agent result summary */}
      {summary && (
        <div className="rounded-md border border-border bg-background p-2.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Agent 执行结果
          </p>
          <p className="text-xs text-foreground leading-relaxed">{summary}</p>
        </div>
      )}

      {/* Annotations list */}
      {annotations.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            批注 ({annotations.length})
          </p>
          {annotations.map((ann) => (
            <div
              key={ann.id}
              className={cn(
                'rounded-md border border-border bg-background p-2.5 flex gap-2',
                ann.resolved && 'opacity-50',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-medium text-foreground">{ann.author}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(ann.createdAt).toLocaleString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {ann.resolved && (
                    <span className="text-[10px] text-emerald-500 font-medium">已解决</span>
                  )}
                </div>
                <p className={cn(
                  'text-xs text-foreground leading-relaxed',
                  ann.resolved && 'line-through',
                )}>
                  {ann.content}
                </p>
              </div>
              {!ann.resolved && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleResolve(ann.id);
                  }}
                  className="shrink-0 size-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                  title="标记为已解决"
                >
                  <Check className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add annotation input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="添加批注..."
          value={newAnnotation}
          onChange={(e) => setNewAnnotation(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleAddAnnotation();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 text-xs bg-background border rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={(e) => {
            e.stopPropagation();
            handleAddAnnotation();
          }}
          disabled={!newAnnotation.trim() || submitting}
        >
          <Send className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
