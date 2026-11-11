'use client';
import { Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/** Label shared agents separately; owned agents sit directly under Agents. */
export function AgentSectionLabel({ owned, online, total, first, showLabels = true, labelClassName }: {
  owned: boolean;
  online: number;
  total: number;
  /** The topmost section, which needs no dividing line above it. */
  first: boolean;
  showLabels?: boolean;
  /** Extra classes for the text, e.g. to hide it on a collapsed sidebar. */
  labelClassName?: string;
}) {
  const t = useT();
  if (owned) return null;
  const label = t('nav.sharedAgentsWithCount', { online, total });
  if (!showLabels) {
    return first ? null : <li role="separator" aria-label={label} className="mx-2 my-1 h-px bg-sidebar-border" />;
  }
  return (
    <li role="presentation" aria-label={label} className={cn('mx-2', !first && 'mt-1.5 border-t border-sidebar-border pt-1.5')}>
      <span className={cn('flex items-center gap-1.5 px-0.5 pb-0.5 text-[11px] font-medium leading-5 text-sidebar-foreground/70', labelClassName)}>
        <Users className="size-3 shrink-0" />
        <span className="truncate" title={label}>{label}</span>
      </span>
    </li>
  );
}
