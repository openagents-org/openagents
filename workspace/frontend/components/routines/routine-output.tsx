'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RoutineOutputProps {
  lastOutput: Record<string, unknown> | null;
  lastFiredAt: string | null;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RoutineOutput({ lastOutput, lastFiredAt }: RoutineOutputProps) {
  const [expanded, setExpanded] = useState(false);

  if (!lastOutput) {
    return (
      <div className="px-3 py-2 border-t border-border bg-muted/30">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock className="size-3" />
          <span>No output yet</span>
        </div>
      </div>
    );
  }

  const status = lastOutput.status as string | undefined;
  const summary = lastOutput.summary as string | undefined;
  const duration = lastOutput.duration as string | undefined;
  const itemsProcessed = lastOutput.itemsProcessed as number | undefined;

  const isSuccess = status === 'success';

  return (
    <div className="border-t border-border bg-muted/30">
      {/* Compact header - always visible */}
      <button
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-muted/50 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
      >
        {expanded ? (
          <ChevronDown className="size-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-3 text-muted-foreground shrink-0" />
        )}

        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {isSuccess ? (
            <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
          ) : (
            <XCircle className="size-3 text-red-500 shrink-0" />
          )}
          <span className="text-[11px] text-muted-foreground truncate">
            Last run: {timeAgo(lastFiredAt)}
          </span>
          {status && (
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0',
                isSuccess
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
              )}
            >
              {status}
            </span>
          )}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-2.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          {summary && (
            <p className="text-[11px] text-foreground/80 leading-relaxed">
              {summary}
            </p>
          )}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            {itemsProcessed !== undefined && (
              <span>{itemsProcessed} items processed</span>
            )}
            {duration && (
              <span>Duration: {duration}</span>
            )}
          </div>
          {/* Render other output fields */}
          {Object.entries(lastOutput).map(([key, value]) => {
            if (['summary', 'status', 'duration', 'itemsProcessed'].includes(key)) return null;
            if (Array.isArray(value)) {
              return (
                <div key={key} className="text-[10px] text-muted-foreground">
                  <span className="font-medium">{key}:</span>{' '}
                  {value.join(', ')}
                </div>
              );
            }
            if (typeof value === 'number' || typeof value === 'string') {
              return (
                <div key={key} className="text-[10px] text-muted-foreground">
                  <span className="font-medium">{key}:</span> {String(value)}
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}
