'use client';

import { cn } from '@/lib/utils';
import { BookOpen } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KnowledgeActionMetadata {
  actionType: 'knowledge_added';
  knowledge: {
    id: string;
    title: string;
    content: string;
    category?: string;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KnowledgeActionCard({ metadata }: { metadata: KnowledgeActionMetadata }) {
  const { knowledge } = metadata;
  const preview = knowledge.content.length > 100
    ? knowledge.content.slice(0, 100) + '…'
    : knowledge.content;

  return (
    <div className="rounded-lg border bg-muted/30 border-l-4 border-l-amber-500 max-w-sm p-3 space-y-1.5">
      {/* Header */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BookOpen className="size-3.5" />
        <span>知识条目已添加</span>
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-foreground leading-snug">
        {knowledge.title}
      </p>

      {/* Preview */}
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
        {preview}
      </p>

      {/* Category badge */}
      {knowledge.category && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">
          {knowledge.category}
        </span>
      )}
    </div>
  );
}
