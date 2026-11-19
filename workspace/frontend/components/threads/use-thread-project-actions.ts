'use client';

import { usePrompt, useConfirm } from '@/components/ui/dialogs-provider';
import { useT } from '@/lib/i18n';
import type { WorkspaceSession } from '@/lib/types';
import type { FilterTab } from './thread-list-utils';
import { useThreadProjects, type ThreadProject } from './use-thread-projects';

/**
 * The thread list's project model plus the prompts around it: create (and
 * optionally file a thread into the new project), rename, remove, and the
 * per-project active-thread counts the project bar shows.
 */
export function useThreadProjectActions({
  workspaceId,
  userId,
  sessions,
  setFilter,
  setSearchQuery,
}: {
  workspaceId: string;
  userId: string;
  sessions: WorkspaceSession[];
  setFilter: (filter: FilterTab) => void;
  setSearchQuery: (query: string) => void;
}) {
  const t = useT();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const projectModel = useThreadProjects(workspaceId, userId, sessions, [
    t('threadProjects.exampleProduct'),
    t('threadProjects.exampleEngineering'),
    t('threadProjects.exampleResearch'),
  ]);

  const projectCounts: Record<string, number> = {};
  sessions.filter(s => s.status === 'active').forEach(s => {
    const id = projectModel.assignments[s.sessionId] || 'unorganized';
    projectCounts[id] = (projectCounts[id] || 0) + 1;
  });

  const createProject = async (threadId?: string) => {
    const name = (await prompt({
      title: t('threadProjects.create'),
      description: t('threadProjects.personalHint'),
      placeholder: t('threadProjects.namePlaceholder'),
      confirmText: t('common.create'),
      validate: value => value.trim().length > 60 ? t('threadProjects.nameTooLong') : null,
    }))?.trim();
    if (!name) return;
    const id = projectModel.create(name);
    if (threadId) projectModel.move(threadId, id);
    else {
      projectModel.select(id);
      projectModel.setGrouped(true);
      setFilter('all');
      setSearchQuery('');
    }
  };

  const renameProject = async (project: ThreadProject) => {
    const name = (await prompt({ title: t('threadProjects.rename'), defaultValue: project.name, confirmText: t('common.rename') }))?.trim();
    if (name) projectModel.rename(project.id, name);
  };

  const removeProject = async (project: ThreadProject) => {
    if (await confirm({
      title: t('threadProjects.remove'),
      description: t('threadProjects.removeHint'),
      confirmText: t('common.delete'),
      destructive: true,
    })) projectModel.remove(project.id);
  };

  return { projectModel, projectCounts, createProject, renameProject, removeProject };
}
