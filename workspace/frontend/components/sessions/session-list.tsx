'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { MoreVertical, Pencil, MessageSquare } from 'lucide-react';
import { SectionHeader } from './section-header';
import type { WorkspaceSession } from '@/lib/types';
import { useState } from 'react';
import { useT } from '@/lib/i18n';

interface SessionListProps {
  sessions: WorkspaceSession[];
  selectedSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onSessionRename: (sessionId: string, title: string) => Promise<void>;
}

function SessionItem({
  session,
  isSelected,
  onSelect,
  onRename,
}: {
  session: WorkspaceSession;
  isSelected: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
}) {
  const t = useT();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.title) {
      onRename(trimmed);
    }
    setIsRenaming(false);
  };

  if (isRenaming) {
    return (
      <div className="px-2 py-1">
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameSubmit();
            if (e.key === 'Escape') setIsRenaming(false);
          }}
          className="w-full text-sm px-2 py-1 border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group relative flex items-center rounded-md hover:bg-muted px-2 py-1 has-data-[state=open]:bg-muted',
        isSelected ? 'bg-primary/10 text-primary' : 'bg-background hover:bg-muted'
      )}
    >
      <Button
        variant="ghost"
        onClick={onSelect}
        className="bg-transparent! justify-start text-foreground/80 flex-1 truncate text-ellipsis w-[195px] p-0 h-auto text-xs"
      >
        <MessageSquare className="size-4 shrink-0 text-muted-foreground/60" />
        <span className="text-sm font-medium truncate text-start">{session.title}</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="ms-auto opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity size-6 -me-1"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              setRenameValue(session.title);
              setIsRenaming(true);
            }}
          >
            <Pencil className="size-4" />
            <span>{t('common.rename')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function SessionList({ sessions, selectedSessionId, onSessionSelect, onSessionRename }: SessionListProps) {
  const t = useT();
  return (
    <div className="space-y-2">
      <SectionHeader label={t('sessions.label')} />
      <div className="space-y-0.5">
        {sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-2">{t('sessions.empty')}</p>
        ) : (
          sessions.map((session) => (
            <SessionItem
              key={session.sessionId}
              session={session}
              isSelected={selectedSessionId === session.sessionId}
              onSelect={() => onSessionSelect(session.sessionId)}
              onRename={(title) => onSessionRename(session.sessionId, title)}
            />
          ))
        )}
      </div>
    </div>
  );
}
