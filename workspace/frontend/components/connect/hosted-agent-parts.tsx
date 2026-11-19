'use client';

import type { ReactNode } from 'react';
import { ArrowUpRight, Trash2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { destructiveIconClass } from '@/lib/destructive-icon';
import type { AcentaUsage, HostedAgent } from '@/lib/types';

const STARTUP_WINDOW_MS = 30 * 60 * 1000;

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** A link that finishes an agent's sign-in and payment on Acenta. */
export function FinishSetupLink({ href }: { href: string }) {
  const t = useT();
  return (
    <Button variant="link" size="xs" className="px-0" asChild>
      <a href={href}>{t('connect.acentaFinishSetup')}<ArrowUpRight data-icon="inline-end" /></a>
    </Button>
  );
}

/** Online, starting (offline soon after launch: the box is still being
 *  prepared), offline — or the way to finish a launch waiting on Acenta. */
export function HostedPresence({ agent }: { agent: HostedAgent }) {
  const t = useT();
  if (agent.status === 'setup' && agent.setupUrl) return <FinishSetupLink href={agent.setupUrl} />;
  const online = agent.presence === 'online';
  const starting = !online && !!agent.createdAt && Date.now() - Date.parse(agent.createdAt) < STARTUP_WINDOW_MS;
  return (
    <span className={cn('flex items-center gap-1.5 text-xs', online ? 'text-success' : 'text-muted-foreground')}>
      {starting && <Spinner className="size-3" />}
      {online ? t('connect.acentaOnline') : starting ? t('connect.acentaStarting') : t('connect.acentaOffline')}
    </span>
  );
}

export function RemoveHostedButton({ onRemove }: { onRemove: () => void }) {
  const t = useT();
  return (
    <WithTooltip label={t('connect.remove')}><Button variant="ghost" size="icon-xs" className={destructiveIconClass} aria-label={t('connect.remove')} onClick={onRemove}>
          <Trash2 />
        </Button></WithTooltip>
  );
}

/** One Acenta agent: its name, a line about it, and what can be done with it. */
export function HostedAgentRow({ title, description, mono, actions }: {
  title: string; description: ReactNode; mono?: boolean; actions: ReactNode;
}) {
  return (
    <Item variant="outline" size="sm" role="listitem">
      <ItemMedia>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/providers/acenta.svg" alt="Acenta" className="size-7 rounded-md object-contain" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full truncate">{title}</ItemTitle>
        <ItemDescription className={cn('truncate text-xs', mono && 'font-mono')}>{description}</ItemDescription>
      </ItemContent>
      <ItemActions>{actions}</ItemActions>
    </Item>
  );
}

/** Balance and this month's spend, with the way to top up. */
export function HostedUsageBar({ usage, lowBalance }: { usage: AcentaUsage; lowBalance: boolean }) {
  const t = useT();
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2.5 text-xs',
      lowBalance ? 'border-warning/30 bg-warning/10' : 'bg-background')}>
      <Wallet className="size-3.5 shrink-0 text-muted-foreground" />
      {usage.balanceEnabled && (
        <span>{t('connect.acentaBalance')} <span className="font-semibold tabular-nums">{formatUsd(usage.balanceCents)}</span></span>
      )}
      <span>{t('connect.acentaSpentThisMonth')} <span className="font-semibold tabular-nums">{formatUsd(usage.spentThisMonthCents)}</span></span>
      {usage.autoTopup && <span className="text-muted-foreground">{t('connect.acentaAutoTopupOn')}</span>}
      {lowBalance && <span className="font-medium text-warning">{t('connect.acentaLowBalance')}</span>}
      {usage.manageUrl && (
        <Button variant="link" size="xs" className="ml-auto px-0" asChild>
          <a href={usage.manageUrl} target="_blank" rel="noreferrer">
            {usage.balanceEnabled ? t('connect.acentaTopUp') : t('connect.acentaBilling')}
            <ArrowUpRight data-icon="inline-end" />
          </a>
        </Button>
      )}
    </div>
  );
}
