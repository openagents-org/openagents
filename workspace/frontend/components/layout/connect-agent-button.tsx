'use client';

import { Plus } from 'lucide-react';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

type ConnectAgentButtonProps = {
  label: string;
  active: boolean;
  showLabels?: boolean;
  onClick: () => void;
};

/** Shared connection entry point for the desktop rail and mobile drawer. */
export function ConnectAgentButton({ label, active, showLabels = true, onClick }: ConnectAgentButtonProps) {
  return (
    <SidebarMenuButton
      aria-label={label}
      tooltip={{ children: label, hidden: showLabels }}
      isActive={active}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'h-8 gap-2 rounded-md bg-brand px-2 text-[13px] font-medium text-brand-foreground transition-colors',
        'hover:bg-brand/90 hover:text-brand-foreground active:bg-brand/90 active:text-brand-foreground',
        'data-active:bg-brand data-active:text-brand-foreground data-active:hover:bg-brand/90',
        'focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
        !showLabels && 'justify-center! px-0',
      )}
    >
      <Plus aria-hidden="true" />
      {showLabels && <span className="min-w-0 truncate">{label}</span>}
    </SidebarMenuButton>
  );
}
