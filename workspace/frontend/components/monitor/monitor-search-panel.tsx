'use client';

import type { RefObject } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { agentLabel } from '@/lib/helpers';
import { useFormatters, useT } from '@/lib/i18n';
import type { WorkspaceAgent, WorkspaceSession } from '@/lib/types';

/** Find any active thread by title or last message, and open it. The popover
 *  is anchored to the grid's bottom-right corner, where the search FAB sits. */
export function MonitorSearchPanel({ open, inputRef, query, onQuery, sessions, gridIds, lastMessageBySession, agents, onSelect, onClose }: {
  open: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (query: string) => void;
  sessions: WorkspaceSession[];
  gridIds: Set<string>;
  lastMessageBySession: Record<string, { content: string; senderName: string } | undefined>;
  agents: WorkspaceAgent[];
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { timeAgo } = useFormatters();
  return (
    <Popover open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <PopoverAnchor asChild>
        <div aria-hidden className="pointer-events-none absolute right-3 bottom-3" />
      </PopoverAnchor>
      {/* Stays open while the user works the grid behind it (clicking or
          scrolling tiles to compare), as the old panel did; Escape closes it. */}
      <PopoverContent
        side="top"
        align="end"
        sideOffset={0}
        className="w-80 gap-0 p-0"
        onInteractOutside={(event) => event.preventDefault()}
      >
        {/* The grid filters by title and last message; cmdk only keeps the
            highlighted row, so Enter opens the top match. */}
        <Command shouldFilter={false}>
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={onQuery}
            placeholder={t('monitor.searchPlaceholder')}
          />
          <CommandList className="max-h-64 p-1">
            <CommandEmpty className="py-6 text-xs">{t('monitor.noThreadsFound')}</CommandEmpty>
            {sessions.map((session) => {
              const preview = lastMessageBySession[session.sessionId];
              const activityMs = session.lastEventAt;
              const displayTime = activityMs
                ? timeAgo(new Date(activityMs).toISOString())
                : session.createdAt ? timeAgo(session.createdAt) : '';
              const sender = preview && (() => {
                const a = agents.find((x) => x.agentName === preview.senderName);
                return a ? agentLabel(a) : preview.senderName;
              })();
              return (
                <CommandItem
                  key={session.sessionId}
                  value={session.sessionId}
                  onSelect={() => onSelect(session.sessionId)}
                  className="items-start gap-2 px-2 py-1.5 text-xs"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{session.title || t('monitor.untitled')}</span>
                      {gridIds.has(session.sessionId) && <Badge variant="secondary">{t('monitor.inGrid')}</Badge>}
                    </div>
                    {preview?.content && (
                      <p className="truncate text-muted-foreground">{sender}: {preview.content}</p>
                    )}
                  </div>
                  {/* CommandShortcut also hides the item's trailing check icon. */}
                  <CommandShortcut className="tracking-normal">{displayTime}</CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
