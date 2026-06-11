'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Layers,
  Globe,
  RefreshCw,
  SquarePen,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLayout } from './layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { WorkspaceSwitcherMenu } from './workspace-switcher-menu';
import { NewThreadDialog } from '@/components/threads/new-thread-dialog';

interface SidebarHeaderProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export function SidebarHeader({ searchQuery, onSearchChange }: SidebarHeaderProps) {
  const {
    workspace,
    setBrowserEnabled,
    refreshAgents,
    refreshWorkspace,
    agents,
    humans,
    sessions,
    createSession,
  } = useWorkspace();
  const { isMobile } = useLayout();
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Workspace-scoped Browser Fabric viewer toggle — mirrors the Safari /
  // globe button in the Swift app's workspace header. Filled-blue when ON.
  const browserEnabled = !!workspace?.browserEnabled;
  const toggleBrowser = () => {
    if (!workspace) return;
    setBrowserEnabled(!browserEnabled).catch(() => {});
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([refreshAgents(), refreshWorkspace()]);
    } finally {
      // Quick spin even if it returned instantly — gives the user a
      // tactile sense that the button did something.
      setTimeout(() => setRefreshing(false), 350);
    }
  };

  const handleNewThread = () => {
    if (agents.length >= 2) {
      setNewThreadOpen(true);
    } else {
      createSession();
    }
  };

  return (
    <>
      <div className="flex flex-col gap-2 shrink-0 px-3 pt-3 pb-2">
        {/* Workspace name row — clicking opens the workspace switcher
            popover (recent workspaces + paste URL + settings/share/copy
            token). Mirrors Swift's `rectangle.stack` switch button next
            to the name. */}
        <div className="flex items-center gap-2">
          <WorkspaceSwitcherMenu
            trigger={
              <button
                className="flex-1 min-w-0 flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group cursor-pointer"
                aria-label="Switch workspace"
              >
                <div className="size-7 shrink-0">
                  <Image
                    src="/logo-black.png"
                    alt="OpenAgents"
                    width={28}
                    height={28}
                    className="size-full object-contain dark:hidden"
                  />
                  <Image
                    src="/logo-white.png"
                    alt="OpenAgents"
                    width={28}
                    height={28}
                    className="size-full object-contain hidden dark:block"
                  />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium truncate">
                    {workspace?.name || 'Workspace'}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate font-mono">
                    {workspace?.slug || ''}
                  </p>
                </div>
                <Layers className="size-3.5 text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            }
          />
          <button
            onClick={toggleBrowser}
            disabled={!workspace}
            className={cn(
              'size-7 flex items-center justify-center rounded-md transition-colors shrink-0',
              browserEnabled
                ? 'bg-primary/10 text-primary hover:bg-primary/15'
                : 'text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800',
            )}
            title={
              browserEnabled
                ? 'Hide browser panel for this workspace'
                : 'Show browser panel when a session is live'
            }
            aria-label={browserEnabled ? 'Disable browser panel' : 'Enable browser panel'}
          >
            <Globe className="size-4" />
          </button>
        </div>

        {/* Search + Refresh + New Chat row — mirrors Swift's ThreadList
            toolbar (.toolbar { Refresh, New Chat }) + .searchable. */}
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-muted/50 border border-input text-muted-foreground">
            <Search className="size-3.5 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search"
              className="text-xs bg-transparent outline-none flex-1 min-w-0 placeholder:text-muted-foreground"
            />
          </div>
          {!isMobile && (
            <button
              onClick={handleRefresh}
              className="size-7 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0"
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
            </button>
          )}
          <button
            onClick={handleNewThread}
            className="size-7 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
            title="New chat"
            aria-label="New chat"
          >
            <SquarePen className="size-3.5" />
          </button>
        </div>
      </div>

      <NewThreadDialog
        open={newThreadOpen}
        onOpenChange={setNewThreadOpen}
        agents={agents}
        humans={humans}
        sessions={sessions}
        onCreateThread={({ master, participants, humanParticipants, resumeFrom }) =>
          createSession({ master, participants, humanParticipants, resumeFrom })
        }
      />
    </>
  );
}
