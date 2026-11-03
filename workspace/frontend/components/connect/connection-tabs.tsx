'use client';

import { Cloud, Server } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function ConnectionTabs({ activeTab, onSelect }: {
  activeTab: 'node' | 'cloud';
  onSelect: (tab: 'node' | 'cloud') => void;
}) {
  const t = useT();
  return (
    <div className="shrink-0 px-6 pt-4 pb-2">
      <div role="group" aria-label={t('connect.title')} className="mx-auto flex w-full max-w-2xl gap-1.5 rounded-xl bg-zinc-100 p-1.5 dark:bg-zinc-800/60">
        {([
          { id: 'node', icon: Server, label: t('connect.tabNode') },
          { id: 'cloud', icon: Cloud, label: t('connect.tabCloud') },
        ] as const).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={activeTab === id}
            onClick={() => onSelect(id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
              activeTab === id
                ? 'bg-background text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" />{label}
          </button>
        ))}
      </div>
    </div>
  );
}
