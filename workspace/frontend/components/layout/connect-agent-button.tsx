'use client';

import { Plus } from 'lucide-react';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';

type ConnectAgentButtonProps = {
  label: string;
  active: boolean;
  showLabels?: boolean;
  onClick: () => void;
};

/** Shared connection entry point for the desktop rail and mobile drawer. */
export function ConnectAgentButton({ label, active, showLabels = true, onClick }: ConnectAgentButtonProps) {
  const { agents, loading, workspaceLoadError } = useWorkspace();
  const needsAgent = !loading && !workspaceLoadError && !agents.some((agent) => !agent.builtin && agent.status === 'online');
  return (
    <SidebarMenuButton
      aria-label={label}
      tooltip={{ children: label, hidden: showLabels }}
      isActive={active}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'h-8 gap-2 rounded-md bg-brand/10 px-2 text-[13px] font-medium text-brand transition-colors',
        'hover:bg-brand/15 hover:text-brand active:bg-brand/20 active:text-brand',
        'data-active:bg-brand/10 data-active:text-brand data-active:hover:bg-brand/15',
        'focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
        !showLabels && 'justify-center! px-0',
        needsAgent && !active && 'ring-2 ring-brand/50 ring-offset-2 ring-offset-sidebar',
      )}
    >
      <Plus aria-hidden="true" />
      {showLabels && <span className="min-w-0 truncate">{label}</span>}
    </SidebarMenuButton>
  );
}
