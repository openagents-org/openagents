'use client';

/**
 * Settings → API credits — the campaign's home inside the workspace.
 *
 * Per-USER (not per-workspace, no admin gate): mission checklist with
 * amounts, daily bonus, the API key, live usage, and how-to instructions.
 * Shows a quiet notice when the campaign is disabled (self-hosted).
 */

import { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, Gift, Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { getCampaignStatus, getCampaignModels, type CampaignStatus } from '@/lib/account-api';
import { SectionHeader } from '@/components/settings/section-chrome';

/** 1234 → "1.2K", 5_600_000 → "5.6M" — token counts don't need precision. */
function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

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
  const [modelsOpen, setModelsOpen] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [copiedModel, setCopiedModel] = useState<string | null>(null);

  const toggleModels = () => {
    setModelsOpen((open) => !open);
    if (!models && idToken) {
      getCampaignModels(idToken)
        .then((r) => setModels(r.models))
        .catch(() => setModels([]));
    }
  };

  const copyModel = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedModel(id);
    setTimeout(() => setCopiedModel(null), 1500);
  };

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
        </div>
      )}

      {/* Usage meter — how much of the unlocked credit this key has consumed */}
      {used !== null && limit !== null && (
        <div className="rounded-xl border bg-background p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('campaign.usageTitle')}</h3>
            <span className="text-xs text-muted-foreground">
              {t('campaign.usageOf', {
                used: fmt(Math.round(used * 100) / 100),
                limit: fmt(Math.round(limit * 100) / 100),
              })}
            </span>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                used / Math.max(limit, 0.01) > 0.85 ? 'bg-amber-500' : 'bg-sky-500'
              }`}
              style={{ width: `${Math.min(100, Math.round((used / Math.max(limit, 0.01)) * 100))}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {t('campaign.usageBody', {
                used: fmt(Math.round(used * 100) / 100),
                remaining: fmt(Math.round((limit - used) * 100) / 100),
              })}
            </span>
            {(status.usage?.inputTokens ?? null) !== null && (
              <span className="tabular-nums">
                {t('campaign.usageTokens', {
                  input: compactNum(status.usage?.inputTokens ?? 0),
                  output: compactNum(status.usage?.outputTokens ?? 0),
                })}
              </span>
            )}
          </div>
          {status.usage?.isActive === false && (
            <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-500">
              {t('campaign.usageExhausted')}
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

        {/* Full model catalog, on demand */}
        <button
          onClick={toggleModels}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <ChevronDown className={`size-3.5 transition-transform ${modelsOpen ? 'rotate-180' : ''}`} />
          {modelsOpen ? t('campaign.hideModels') : t('campaign.showAllModels')}
        </button>
        {modelsOpen && (
          <div className="mt-3 rounded-lg border bg-muted/30 p-3">
            {models === null ? (
              <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : models.length === 0 ? (
              <p className="text-xs text-muted-foreground">—</p>
            ) : (
              <>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  {t('campaign.modelsCount', { count: models.length })}
                </p>
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {models.map((id) => (
                    <button
                      key={id}
                      onClick={() => copyModel(id)}
                      className="flex items-center gap-1.5 truncate rounded-md px-2 py-1 text-left font-mono text-[12px] transition-colors hover:bg-accent"
                      title={id}
                    >
                      {copiedModel === id ? (
                        <Check className="size-3 shrink-0 text-green-600" />
                      ) : (
                        <Copy className="size-3 shrink-0 text-muted-foreground/50" />
                      )}
                      <span className="truncate">{id}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
