'use client';

import { Check, Gift } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { CampaignStatus } from '@/lib/account-api';
import { useT, type MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { fmtUsd } from './format';

const MISSION_LABEL_KEYS: Record<string, MessageKey> = {
  signup: 'campaign.msSignup',
  first_agent: 'campaign.msFirstAgent',
  first_conversation: 'campaign.msFirstConversation',
  second_agent: 'campaign.msSecondAgent',
  second_agent_response: 'campaign.msSecondAgentResponse',
};

/** While the campaign runs: overall progress, the mission checklist and the daily bonus. */
export function CampaignLadder({ status }: { status: CampaignStatus }) {
  const t = useT();
  const cap = status.capUsd ?? 100;
  const total = status.totalGrantedUsd ?? 0;
  const pct = Math.min(100, Math.round((total / cap) * 100));
  const missions = status.milestones || [];
  const allDone = missions.length > 0 && missions.every((m) => m.grantedAt);

  return (
    <>
      <Card size="sm">
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Gift className="size-4 text-success" />
              {t('campaign.unlocked', { total: fmtUsd(total), cap: fmtUsd(cap) })}
            </span>
            {allDone && <span className="text-xs text-muted-foreground">{t('campaign.complete')}</span>}
          </div>
          <Progress value={pct} className="h-2.5 *:data-[slot=progress-indicator]:bg-success" />
          {/* Pilot Program credits stack on top of the ladder — say so, or the
              bar reads as if the $300 were missing. */}
          {status.pilot && (
            <p className="text-xs text-muted-foreground">
              🚀 {t('campaign.pilotBonus', {
                amount: fmtUsd(status.pilot.amountUsd),
                total: fmtUsd(status.grandTotalUsd ?? total + status.pilot.amountUsd),
              })}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{t('campaign.missionsTitle')}</h3>
        <Card className="gap-0 divide-y py-0" role="list">
          {missions.map((m) => {
            const done = !!m.grantedAt;
            const label = MISSION_LABEL_KEYS[m.key];
            return (
              <div role="listitem" key={m.key} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border',
                    done ? 'border-success bg-success text-background' : 'text-transparent',
                  )}
                >
                  <Check className="size-3" strokeWidth={3.5} />
                </span>
                <span className={done ? 'font-medium' : 'text-muted-foreground'}>{label ? t(label) : m.key}</span>
                <span className={cn('ms-auto font-semibold tabular-nums', done ? 'text-success' : 'text-muted-foreground')}>
                  +${m.amountUsd}
                </span>
              </div>
            );
          })}
        </Card>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{t('campaign.dailyTitle')}</CardTitle>
          <CardDescription>
            {t('campaign.dailyBody', { amount: status.daily?.grantUsd ?? 10, cap: fmtUsd(cap) })}
          </CardDescription>
        </CardHeader>
        {(status.daily?.daysGranted ?? 0) > 0 && (
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {t('campaign.dailyProgress', { days: status.daily?.daysGranted ?? 0 })}
            </p>
          </CardContent>
        )}
      </Card>
    </>
  );
}
