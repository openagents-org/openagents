'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { useWorkspace } from '@/lib/workspace-context';

/**
 * Sidebar brand block: logo + workspace name (click to rename) + slug.
 * Collapses to just the logo on the icon rail.
 */
export function Brand() {
  const { workspace, renameWorkspace } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setDraft(workspace?.name || '');
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== workspace?.name) {
      renameWorkspace(trimmed);
    }
  };

  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <span className="relative flex size-8 shrink-0 items-center justify-center">
        <Image src="/logo-black.png" alt="OpenAgents" width={32} height={32} className="size-full object-contain dark:hidden" />
        <Image src="/logo-white.png" alt="OpenAgents" width={32} height={32} className="size-full object-contain hidden dark:block" />
      </span>

      <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-full min-w-0 border-b border-primary bg-transparent text-sm font-medium outline-none"
            autoFocus
          />
        ) : (
          <span
            className="truncate text-sm font-medium cursor-pointer transition-colors hover:text-primary"
            onClick={startEditing}
            title="Click to rename"
          >
            {workspace?.name || 'Workspace'}
          </span>
        )}
        <span className="truncate font-mono text-xs text-muted-foreground">{workspace?.slug || ''}</span>
      </div>
    </div>
  );
}
