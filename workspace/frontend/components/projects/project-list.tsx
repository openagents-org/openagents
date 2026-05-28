'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, FolderOpen, Plus, Settings, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Project, ChannelSection, WorkspaceSession } from '@/lib/types';
import { ProjectSection } from './project-section';

interface ProjectListProps {
  projects: Project[];
  currentSessionId: string | null;
  onSelectChannel: (sessionId: string) => void;
  onCreateProject?: () => void;
  onCreateChannel?: (projectId: string) => void;
  onContextBotClick?: (projectId: string) => void;
}

export function ProjectList({
  projects,
  currentSessionId,
  onSelectChannel,
  onCreateProject,
  onCreateChannel,
  onContextBotClick,
}: ProjectListProps) {
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  const toggleProject = (projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  if (projects.length === 0) {
    return (
      <div className="px-3 py-4">
        <button
          onClick={onCreateProject}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors text-sm"
        >
          <Plus className="size-4" />
          <span>Create first project</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {projects.map((project) => {
        const isCollapsed = collapsedProjects.has(project.projectId);

        return (
          <div key={project.projectId} className="group">
            {/* Project Header */}
            <button
              onClick={() => toggleProject(project.projectId)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-left"
            >
              {isCollapsed ? (
                <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
              )}
              <FolderOpen className="size-3.5 text-primary shrink-0" />
              <span className="text-sm font-medium text-foreground truncate flex-1">
                {project.name}
              </span>
              <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                {project.channels?.length || 0}
              </span>
            </button>

            {/* Project Contents */}
            {!isCollapsed && (
              <div className="ml-3 pl-2 border-l border-border/50">
                {/* Context Bot Entry */}
                <button
                  onClick={() => onContextBotClick?.(project.projectId)}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-accent transition-colors text-left"
                >
                  <Bot className="size-3.5 text-primary/70" />
                  <span className="text-xs text-muted-foreground">
                    {project.contextBotName || 'Context Bot'}
                  </span>
                </button>

                {/* Sections & Channels */}
                <ProjectSection
                  project={project}
                  currentSessionId={currentSessionId}
                  onSelectChannel={onSelectChannel}
                />

                {/* Add Channel */}
                <button
                  onClick={() => onCreateChannel?.(project.projectId)}
                  className="w-full flex items-center gap-2 px-2 py-1 mt-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Plus className="size-3" />
                  <span className="text-xs">Add channel</span>
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Create New Project */}
      <button
        onClick={onCreateProject}
        className="flex items-center gap-2 px-2 py-1.5 mt-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <Plus className="size-3.5" />
        <span className="text-xs">New project</span>
      </button>
    </div>
  );
}
