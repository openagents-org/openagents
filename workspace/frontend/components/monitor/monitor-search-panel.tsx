'use client';

import type { RefObject } from 'react';
import { Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { agentLabel } from '@/lib/helpers';
import { useFormatters, useT } from '@/lib/i18n';
import type { WorkspaceAgent, WorkspaceSession } from '@/lib/types';

/** Find any active thread by title or last message, and open it. */
export function MonitorSearchPanel({ inputRef, query, onQuery, sessions, gridIds, lastMessageBySession, agents, onSelect, onClose }: {
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
    <div className="absolute right-3 bottom-3 z-20 w-80 overflow-hidden rounded-xl border bg-popover shadow-xl">
      <div className="border-b p-2">
        <InputGroup>
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && sessions.length > 0) onSelect(sessions[0].sessionId);
            }}
            placeholder={t('monitor.searchPlaceholder')}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" onClick={onClose} aria-label={t('common.close')}><X /></InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>

      <div className="max-h-64 overflow-y-auto p-1">
        {sessions.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">{t('monitor.noThreadsFound')}</p>
        ) : (
          sessions.map((session) => {
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
              <button
                type="button"
                key={session.sessionId}
                onClick={() => onSelect(session.sessionId)}
                className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-xs font-medium">
                    {session.title || t('monitor.untitled')}
                  </span>
                  {gridIds.has(session.sessionId) && <Badge variant="secondary">{t('monitor.inGrid')}</Badge>}
                  <span className="shrink-0 text-xs text-muted-foreground">{displayTime}</span>
                </div>
                {preview?.content && (
                  <p className="truncate text-xs text-muted-foreground">{sender}: {preview.content}</p>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
