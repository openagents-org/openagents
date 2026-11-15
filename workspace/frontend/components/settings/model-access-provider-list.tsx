'use client';

import { ProviderIcon } from '@/components/icons/agent-icons';
import { Button } from '@/components/ui/button';
import { useT, type MessageKey } from '@/lib/i18n';
import type { CloudAgentProvider } from '@/lib/types';

export interface ProviderGroup {
  key: MessageKey;
  items: CloudAgentProvider[];
}

/** The left pane of the add-model-access dialog: grouped providers, one chosen. */
export function ModelAccessProviderList({
  groups,
  customKinds,
  selected,
  providerLabel,
  onSelect,
}: {
  groups: ProviderGroup[];
  customKinds: readonly string[];
  selected: string;
  providerLabel: (name: string) => string;
  onSelect: (name: string) => void;
}) {
  const t = useT();

  const section = (title: MessageKey, entries: { name: string; icon: string }[]) => (
    <div key={title} className="flex flex-col gap-0.5">
      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{t(title)}</div>
      {entries.map(({ name, icon }) => (
        <Button
          key={name}
          type="button"
          variant="ghost"
          aria-pressed={selected === name}
          onClick={() => onSelect(name)}
          className="w-full justify-start gap-2.5 px-2 font-normal aria-pressed:bg-muted aria-pressed:font-medium"
        >
          <span className="flex size-4.5 shrink-0 items-center justify-center">
            <ProviderIcon name={icon} size={18} />
          </span>
          <span className="truncate">{providerLabel(name)}</span>
        </Button>
      ))}
    </div>
  );

  return (
    <nav aria-label={t('admin.modelAccessProvider')} className="flex flex-col gap-2">
      {groups.map((g) => section(g.key, g.items.map((p) => ({ name: p.name, icon: p.name }))))}
      {section('admin.modelAccessGroupCustom', customKinds.map((k) => ({ name: k, icon: 'custom' })))}
    </nav>
  );
}
