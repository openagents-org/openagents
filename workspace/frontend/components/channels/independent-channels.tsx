'use client';

import { Hash, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceSession } from '@/lib/types';

interface IndependentChannelsProps {
  channels: WorkspaceSession[];
  currentSessionId: string | null;
  onSelectChannel: (sessionId: string) => void;
}

/**
 * Shows channels that don't belong to any project (independent/standalone channels).
 */
export function IndependentChannels({ channels, currentSessionId, onSelectChannel }: IndependentChannelsProps) {
  if (channels.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 py-1">
        <MessageCircle className="size-3 text-muted-foreground" />
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Channels
        </span>
      </div>
      <div className="flex flex-col gap-px">
        {channels.map((channel) => (
          <button
            key={channel.sessionId}
            onClick={() => onSelectChannel(channel.sessionId)}
            className={cn(
              'w-full flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors text-left',
              currentSessionId === channel.sessionId
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-foreground/80 hover:bg-accent'
            )}
          >
            <Hash className={cn(
              'size-3 shrink-0',
              currentSessionId === channel.sessionId ? 'text-primary' : 'text-muted-foreground'
            )} />
            <span className="text-xs truncate">
              {channel.title || channel.sessionId}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
