'use client';

import { useState } from 'react';
import { CirclePlus } from 'lucide-react';
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
  // Expanded, the tooltip only earns its place when the label is cut off
  // (long translations): checked on hover, before the tooltip's open delay.
  const [truncated, setTruncated] = useState(false);
  return (
    <SidebarMenuButton
      aria-label={label}
      // Expanded, the inbox envelope sits to the right, so the tooltip drops below.
      tooltip={{ children: label, hidden: showLabels && !truncated, side: showLabels ? 'bottom' : 'right' }}
      isActive={active}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onPointerEnter={(event) => {
        const text = event.currentTarget.querySelector<HTMLElement>('[data-label]');
        setTruncated(!!text && text.scrollWidth > text.clientWidth);
      }}
      // shadcn dashboard-01's Quick Create button: the one primary-filled row.
      className={cn(
        'min-w-8 gap-2 bg-primary text-primary-foreground duration-200 ease-linear',
        'hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground',
        'data-active:bg-primary data-active:text-primary-foreground data-active:hover:bg-primary/90',
        'focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
        !showLabels && 'justify-center! px-0',
        // Inset, so the hint never grows the button past the inbox beside it.
        needsAgent && !active && 'ring-2 ring-inset ring-primary-foreground/30',
      )}
    >
      <CirclePlus aria-hidden="true" />
      {showLabels && <span data-label className="min-w-0 truncate">{label}</span>}
    </SidebarMenuButton>
  );
}
