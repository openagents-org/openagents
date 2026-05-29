'use client';

import { cn } from '@/lib/utils';
import { Eye } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewActionMetadata {
  actionType: 'review_requested';
  review: {
    taskId: string;
    taskTitle: string;
    status: 'pending' | 'approved' | 'changes_requested';
    commentCount?: number;
  };
}

// ---------------------------------------------------------------------------
// Status styles
// ---------------------------------------------------------------------------

const REVIEW_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: {
    label: '待审阅',
    className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  approved: {
    label: '已通过',
    className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  changes_requested: {
    label: '需修改',
    className: 'bg-red-500/15 text-red-600 dark:text-red-400',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReviewActionCard({ metadata }: { metadata: ReviewActionMetadata }) {
  const { review } = metadata;
  const statusInfo = REVIEW_STATUS_BADGE[review.status] || REVIEW_STATUS_BADGE.pending;

  return (
    <div className="rounded-lg border bg-muted/30 border-l-4 border-l-indigo-500 max-w-sm p-3 space-y-1.5">
      {/* Header */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Eye className="size-3.5" />
        <span>Review 请求</span>
      </div>

      {/* Task title */}
      <p className="text-sm font-medium text-foreground leading-snug">
        {review.taskTitle}
      </p>

      {/* Status + comment count */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={cn(
            'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
            statusInfo.className,
          )}
        >
          {statusInfo.label}
        </span>
        {review.commentCount != null && review.commentCount > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {review.commentCount} 条评论
          </span>
        )}
      </div>
    </div>
  );
}
