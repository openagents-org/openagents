'use client';

/**
 * Settings → API credits — the campaign's home inside the workspace.
 *
 * Per-USER (not per-workspace, no admin gate): mission checklist with
 * amounts, daily bonus, the API key, live usage, and how-to instructions.
 * Shows a quiet notice when the campaign is disabled (self-hosted).
 */

import { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { SectionHeader } from '@/components/settings/section-chrome';
import { CampaignHowtoCard } from '@/components/settings/api-credits/campaign-howto-card';
import { CampaignKeyCard, CampaignUsageCard } from '@/components/settings/api-credits/campaign-key-usage';
import { CampaignLadder } from '@/components/settings/api-credits/campaign-ladder';
import { fmtUsd } from '@/components/settings/api-credits/format';
import { VerifyEmailGate } from '@/components/settings/api-credits/verify-email-gate';
import { useT } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { getCampaignStatus, type CampaignStatus } from '@/lib/account-api';

export default function ApiCreditsSettingsPage() {
  const t = useT();
  const { idToken } = useOpenAgentsAuth();
  const [status, setStatus] = useState<CampaignStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!idToken) { setLoading(false); return; }
    let cancelled = false;
    getCampaignStatus(idToken)
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [idToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Spinner />
      </div>
    );
  }

  // The campaign ended: people who already hold a key still see it and its usage.
  const ended = !status?.enabled && !!status?.ended;
  if (!status || (!status.enabled && !ended)) {
    return (
      <div className="flex flex-col gap-6">
        <SectionHeader title={t('campaign.pageTitle')} description={t('campaign.pageDescription')} />
        <p className="text-sm text-muted-foreground">{t('campaign.notAvailable')}</p>
      </div>
    );
  }

  const cap = status.capUsd ?? 100;
  const total = status.totalGrantedUsd ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader title={t('campaign.pageTitle')} description={t(ended ? 'campaign.endedDescription' : 'campaign.pageDescription')} />

      {ended && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="size-4 text-success" />
              {t('campaign.endedTitle', { total: fmtUsd(status.grandTotalUsd ?? total) })}
            </CardTitle>
            <CardDescription>{t('campaign.endedBody')}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Unverified: the key and the first rewards are already here; the rest
          of the ladder waits for a confirmed address. */}
      {!ended && status.requiresEmailVerification && (
        <VerifyEmailGate email={status.email || ''} idToken={idToken} allowance={status.unverifiedAllowanceUsd} cap={cap} />
      )}

      {/* Overall progress, missions and daily bonus only while the campaign runs */}
      {!ended && <CampaignLadder status={status} />}

      {status.apiKey && <CampaignKeyCard apiKey={status.apiKey} />}

      {/* A key minted but not yet metered reports nulls — no meter until it has numbers. */}
      {status.usage && status.usage.costUsdUsed != null && status.usage.costLimitUsd != null && (
        <CampaignUsageCard usage={status.usage} />
      )}

      <CampaignHowtoCard gatewayUrl={status.gatewayUrl} idToken={idToken} />
    </div>
  );
}
