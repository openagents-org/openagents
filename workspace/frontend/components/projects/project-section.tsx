'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Hash, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Project, WorkspaceSession } from '@/lib/types';

interface ProjectSectionProps {
  project: Project;
  currentSessionId: string | null;
  onSelectChannel: (sessionId: string) => void;
}

export function ProjectSection({ project, currentSessionId, onSelectChannel }: ProjectSectionProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const sections = project.sections || [];
  const channels = project.channels || [];

  // Group channels by section
  const channelsBySection = new Map<string | null, WorkspaceSession[]>();
  channelsBySection.set(null, []); // Unsectioned channels

  for (const section of sections) {
    channelsBySection.set(section.sectionId, []);
  }

  for (const channel of channels) {
    const sectionId = (channel as any).sectionId || null;
    const list = channelsBySection.get(sectionId) || channelsBySection.get(null)!;
    list.push(channel);
  }

  return (
    <div className="flex flex-col gap-px">
      {/* Channels without a section */}
      {(channelsBySection.get(null) || []).map((channel) => (
        <ChannelItem
          key={channel.sessionId}
          channel={channel}
          isActive={currentSessionId === channel.sessionId}
          onClick={() => onSelectChannel(channel.sessionId)}
        />
      ))}

      {/* Sections with their channels */}
      {sections
        .sort((a, b) => a.position - b.position)
        .map((section) => {
          const sectionChannels = channelsBySection.get(section.sectionId) || [];
          const isCollapsed = collapsedSections.has(section.sectionId);

          return (
            <div key={section.sectionId}>
              {/* Section Header */}
              <button
                onClick={() => toggleSection(section.sectionId)}
                className="w-full flex items-center gap-1 px-2 py-1 text-left"
              >
                {isCollapsed ? (
                  <ChevronRight className="size-2.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-2.5 text-muted-foreground" />
                )}
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  {section.name}
                </span>
              </button>

              {/* Section Channels */}
              {!isCollapsed && sectionChannels.map((channel) => (
                <ChannelItem
                  key={channel.sessionId}
                  channel={channel}
                  isActive={currentSessionId === channel.sessionId}
                  onClick={() => onSelectChannel(channel.sessionId)}
                />
              ))}
            </div>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channel Item
// ---------------------------------------------------------------------------

interface ChannelItemProps {
  channel: WorkspaceSession;
  isActive: boolean;
  onClick: () => void;
  unreadCount?: number;
}

function ChannelItem({ channel, isActive, onClick, unreadCount }: ChannelItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors text-left group',
        isActive
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-foreground/80 hover:bg-accent'
      )}
    >
      <Hash className={cn('size-3 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
      <span className="text-xs truncate flex-1">
        {channel.title || channel.sessionId}
      </span>
      {channel.starred && (
        <Star className="size-2.5 text-amber-500 fill-amber-500 shrink-0" />
      )}
      {unreadCount && unreadCount > 0 && (
        <span className="px-1.5 py-0.5 bg-primary text-primary-foreground text-[10px] font-medium rounded-full leading-none">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
