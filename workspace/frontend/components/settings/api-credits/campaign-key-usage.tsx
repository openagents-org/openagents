'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { CampaignStatus } from '@/lib/account-api';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { CopyButton } from './copy-button';
import { compactNum, fmtCents } from './format';

/** The campaign API key: masked until clicked, copyable either way. */
export function CampaignKeyCard({ apiKey }: { apiKey: string }) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const masked = `${apiKey.slice(0, 12)}…${apiKey.slice(-4)}`;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('campaign.keyTitle')}</CardTitle>
        <CardDescription>{t('campaign.keyHint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <button
          onClick={() => setRevealed((v) => !v)}
          className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-3 py-2 text-left font-mono text-sm hover:bg-muted"
        >
          {revealed ? apiKey : masked}
        </button>
        <CopyButton value={apiKey} title={t('campaign.keyTitle')} />
      </CardContent>
    </Card>
  );
}

/** How much of the unlocked credit this key has consumed. */
export function CampaignUsageCard({ usage }: { usage: NonNullable<CampaignStatus['usage']> }) {
  const t = useT();
  const used = usage.costUsdUsed;
  const limit = usage.costLimitUsd;
  const ratio = used / Math.max(limit, 0.01);
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('campaign.usageTitle')}</h3>
          <span className="text-xs text-muted-foreground">
            {t('campaign.usageOf', { used: fmtCents(used), limit: fmtCents(limit) })}
          </span>
        </div>
        <Progress
          value={Math.min(100, Math.round(ratio * 100))}
          className={cn(
            'h-2.5',
            ratio > 0.85 ? '*:data-[slot=progress-indicator]:bg-warning' : '*:data-[slot=progress-indicator]:bg-info',
          )}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t('campaign.usageBody', { used: fmtCents(used), remaining: fmtCents(limit - used) })}</span>
          {(usage.inputTokens ?? null) !== null && (
            <span className="tabular-nums">
              {t('campaign.usageTokens', {
                input: compactNum(usage.inputTokens ?? 0),
                output: compactNum(usage.outputTokens ?? 0),
              })}
            </span>
          )}
        </div>
        {usage.isActive === false && (
          <p className="text-xs font-medium text-warning">{t('campaign.usageExhausted')}</p>
        )}
      </CardContent>
    </Card>
  );
}
