'use client';

/**
 * Settings → API credits — the campaign's home inside the workspace.
 *
 * Per-USER (not per-workspace, no admin gate): mission checklist with
 * amounts, daily bonus, the API key, live usage, and how-to instructions.
 * Shows a quiet notice when the campaign is disabled (self-hosted).
 */

import { useEffect, useState } from 'react';
import { Check, Copy, Gift, Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { getCampaignStatus, type CampaignStatus } from '@/lib/account-api';
import { SectionHeader } from '@/components/settings/section-chrome';

const MISSION_LABEL_KEYS: Record<string, string> = {
  signup: 'campaign.msSignup',
  first_agent: 'campaign.msFirstAgent',
  first_conversation: 'campaign.msFirstConversation',
  second_agent: 'campaign.msSecondAgent',
  second_agent_response: 'campaign.msSecondAgentResponse',
};

function CopyBtn({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border bg-background transition-colors hover:bg-accent"
      title={title}
    >
      {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export default function ApiCreditsSettingsPage() {
  const t = useT();
  const { idToken } = useOpenAgentsAuth();
  const [status, setStatus] = useState<CampaignStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyRevealed, setKeyRevealed] = useState(false);

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
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  if (!status?.enabled) {
    return (
      <div>
        <SectionHeader title={t('campaign.pageTitle')} description={t('campaign.pageDescription')} />
        <p className="mt-6 text-sm text-muted-foreground">{t('campaign.notAvailable')}</p>
      </div>
    );
  }

  const cap = status.capUsd ?? 100;
  const total = status.totalGrantedUsd ?? 0;
  const pct = Math.min(100, Math.round((total / cap) * 100));
  const missions = status.milestones || [];
  const allDone = missions.length > 0 && missions.every((m) => m.grantedAt);
  const key = status.apiKey || '';
  const maskedKey = key ? `${key.slice(0, 12)}…${key.slice(-4)}` : '';
  const used = status.usage?.costUsdUsed ?? null;
  const limit = status.usage?.costLimitUsd ?? null;
  const fmt = (n: number) => (n % 1 ? n.toFixed(2) : String(n));

  return (
    <div className="space-y-8">
      <SectionHeader title={t('campaign.pageTitle')} description={t('campaign.pageDescription')} />

      {/* Overall progress */}
      <div className="rounded-xl border bg-background p-5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Gift className="size-4 text-emerald-600 dark:text-emerald-400" />
            {t('campaign.unlocked', { total: fmt(total), cap: fmt(cap) })}
          </span>
          {allDone && <span className="text-xs text-muted-foreground">{t('campaign.complete')}</span>}
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Missions */}
      <div>
        <h3 className="text-sm font-semibold">{t('campaign.missionsTitle')}</h3>
        <ul className="mt-3 space-y-2">
          {missions.map((m) => {
            const done = !!m.grantedAt;
            return (
              <li key={m.key} className="flex items-center gap-3 rounded-lg border bg-background px-3.5 py-2.5 text-sm">
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${done ? 'border-emerald-500 bg-emerald-500 text-white' : 'text-transparent'}`}
                >
                  <Check className="size-3" strokeWidth={3.5} />
                </span>
                <span className={done ? 'font-medium' : 'text-muted-foreground'}>
                  {t(MISSION_LABEL_KEYS[m.key] as Parameters<typeof t>[0]) || m.key}
                </span>
                <span className={`ml-auto font-semibold tabular-nums ${done ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                  +${m.amountUsd}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Daily bonus */}
      <div className="rounded-xl border bg-background p-5">
        <h3 className="text-sm font-semibold">{t('campaign.dailyTitle')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('campaign.dailyBody', { amount: status.daily?.grantUsd ?? 10, cap: fmt(cap) })}
        </p>
        {(status.daily?.daysGranted ?? 0) > 0 && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t('campaign.dailyProgress', { days: status.daily?.daysGranted ?? 0 })}
          </p>
        )}
      </div>

      {/* API key + usage */}
      {key && (
        <div className="rounded-xl border bg-background p-5">
          <h3 className="text-sm font-semibold">{t('campaign.keyTitle')}</h3>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={() => setKeyRevealed((v) => !v)}
              className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-3 py-2 text-left font-mono text-[13px] hover:bg-muted"
            >
              {keyRevealed ? key : maskedKey}
            </button>
            <CopyBtn value={key} title={t('campaign.keyTitle')} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('campaign.keyHint')}</p>
          {used !== null && limit !== null && (
            <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              <span className="font-semibold">{t('campaign.usageTitle')}:</span>{' '}
              {t('campaign.usageBody', {
                used: fmt(Math.round(used * 100) / 100),
                remaining: fmt(Math.round((limit - used) * 100) / 100),
              })}
            </p>
          )}
        </div>
      )}

      {/* How to use */}
      <div className="rounded-xl border bg-background p-5">
        <h3 className="text-sm font-semibold">{t('campaign.howtoTitle')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('campaign.howtoBody')}</p>
        <div className="mt-3 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-3 py-2 font-mono text-[13px]">
            {status.gatewayUrl}/v1
          </code>
          <CopyBtn value={`${status.gatewayUrl}/v1`} title={t('campaign.howtoBaseUrl')} />
        </div>
        <p className="mt-2.5 text-xs text-muted-foreground">{t('campaign.howtoModels')}</p>
      </div>
    </div>
  );
}
