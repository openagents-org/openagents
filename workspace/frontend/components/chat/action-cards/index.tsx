'use client';

import { TaskActionCard, type TaskActionMetadata } from './task-action-card';
import { KnowledgeActionCard, type KnowledgeActionMetadata } from './knowledge-action-card';
import { RoutineActionCard, type RoutineActionMetadata } from './routine-action-card';
import { FileActionCard, type FileActionMetadata } from './file-action-card';
import { ReviewActionCard, type ReviewActionMetadata } from './review-action-card';

// ---------------------------------------------------------------------------
// Union type for all supported action metadata
// ---------------------------------------------------------------------------

export type ActionMetadata =
  | TaskActionMetadata
  | KnowledgeActionMetadata
  | RoutineActionMetadata
  | FileActionMetadata
  | ReviewActionMetadata;

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface ActionCardRendererProps {
  metadata?: Record<string, unknown>;
}

export function ActionCardRenderer({ metadata }: ActionCardRendererProps) {
  if (!metadata || !metadata.actionType) return null;

  const actionType = metadata.actionType as string;

  switch (actionType) {
    case 'task_created':
    case 'task_updated':
      return <TaskActionCard metadata={metadata as unknown as TaskActionMetadata} />;
    case 'knowledge_added':
      return <KnowledgeActionCard metadata={metadata as unknown as KnowledgeActionMetadata} />;
    case 'routine_created':
      return <RoutineActionCard metadata={metadata as unknown as RoutineActionMetadata} />;
    case 'file_shared':
      return <FileActionCard metadata={metadata as unknown as FileActionMetadata} />;
    case 'review_requested':
      return <ReviewActionCard metadata={metadata as unknown as ReviewActionMetadata} />;
    default:
      return null;
  }
}
