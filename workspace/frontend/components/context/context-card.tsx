'use client';

import { BookOpen } from 'lucide-react';
import type { ContextQueryResult } from '@/lib/types';

interface ContextCardProps {
  result: ContextQueryResult;
  question?: string;
}

/**
 * Renders a context query result as a card within the chat message stream.
 */
export function ContextCard({ result, question }: ContextCardProps) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 my-2 max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <BookOpen className="size-4 text-primary" />
        <span className="text-xs font-medium text-primary">Project Context</span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {result.source === 'openclaw' ? 'via OpenClaw' : 'local lookup'}
        </span>
      </div>

      {/* Question */}
      {question && (
        <p className="text-xs text-muted-foreground italic mb-2">
          &ldquo;{question}&rdquo;
        </p>
      )}

      {/* Answer */}
      <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
        {result.answer}
      </div>

      {/* Source Keys */}
      {result.contextKeysUsed.length > 0 && (
        <div className="mt-3 pt-2 border-t border-primary/10 flex gap-1.5 flex-wrap">
          {result.contextKeysUsed.map((key) => (
            <span
              key={key}
              className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-medium rounded-full"
            >
              {key}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
