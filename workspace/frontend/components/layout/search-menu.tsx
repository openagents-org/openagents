'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Search } from 'lucide-react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { getFileIcon } from '@/components/files/file-utils';
import { isRecentAgent } from '@/lib/helpers';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from './layout-context';

/** ⌘K palette over threads, files and agents. */
export function SearchMenu({ iconOnly = false }: { iconOnly?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const { sessions, files, agents, setCurrentSessionId, setSelectedFileId } = useWorkspace();
  const { openView, setSelectedAgentName, openMobileDetail } = useLayout();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const threads = sessions.filter((s) => !s.sessionId.startsWith('routine:'));
  const recentAgents = agents.filter(isRecentAgent);

  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Search (⌘K)"
        className={
          iconOnly
            ? 'flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            : 'flex h-8 items-center gap-2 rounded-md px-2 text-muted-foreground transition-colors hover:bg-muted'
        }
      >
        <Search className="size-4" />
        {!iconOnly && (
          <>
            <span className="hidden text-xs lg:inline">Search</span>
            <kbd className="hidden items-center gap-0.5 rounded border border-border px-1 font-mono text-[10px] lg:inline-flex">
              <span className="text-xs">⌘</span>K
            </kbd>
          </>
        )}
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search workspace"
        description="Search threads, files and agents"
      >
        {/* CommandDialog only renders the dialog shell — cmdk still needs its own root */}
        <Command>
          <CommandInput placeholder="Search threads, files, agents…" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            {threads.length > 0 && (
              <CommandGroup heading="Threads">
                {threads.map((session) => (
                  <CommandItem
                    key={session.sessionId}
                    value={`thread ${session.title} ${session.sessionId}`}
                    onSelect={() =>
                      run(() => {
                        openView('threads');
                        setCurrentSessionId(session.sessionId);
                        openMobileDetail();
                      })
                    }
                  >
                    <MessageSquare />
                    <span className="truncate">{session.title || 'Untitled thread'}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {files.length > 0 && (
              <CommandGroup heading="Files">
                {files.map((file) => (
                  <CommandItem
                    key={file.id}
                    value={`file ${file.filename}`}
                    onSelect={() =>
                      run(() => {
                        openView('files');
                        setSelectedFileId(file.id);
                        openMobileDetail();
                      })
                    }
                  >
                    {getFileIcon(file.contentType, file.filename)}
                    <span className="truncate">{file.filename}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {recentAgents.length > 0 && (
              <CommandGroup heading="Agents">
                {recentAgents.map((agent) => (
                  <CommandItem
                    key={agent.agentName}
                    value={`agent ${agent.agentName}`}
                    onSelect={() => run(() => setSelectedAgentName(agent.agentName))}
                  >
                    <AgentAvatar
                      name={agent.agentName}
                      size={20}
                      status={agent.status}
                      className="[&_svg]:size-full!"
                    />
                    <span className="truncate">{agent.agentName}</span>
                    {/* CommandShortcut, not a bare `ml-auto` span: CommandItem
                        always renders a trailing check icon that also carries
                        `ml-auto`, and two auto margins split the free space
                        between them — which parked the status mid-row. The
                        `data-slot` on CommandShortcut hides that check. */}
                    <CommandShortcut className="tracking-normal">
                      {agent.status === 'online' ? 'online' : 'offline'}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
