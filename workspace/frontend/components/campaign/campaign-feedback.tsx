'use client';

/**
 * In-workspace feedback for the API credits campaign.
 *
 * - <CampaignMilestoneToasts/>: polls /v1/campaign/status while the tab is
 *   visible and fires a toast for every newly granted milestone, so the reward
 *   lands the moment it's earned (the inbox notification is the durable copy).
 * - <CampaignConnectHint/>: inline incentive banner for the Connect view —
 *   tells the user which agent-connection credit is up next.
 *
 * Both render nothing on self-hosted deployments (status.enabled === false)
 * and stop polling entirely in that case.
 */

import { useEffect, useRef, useState } from 'react';
import { Gift, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { capture } from '@/lib/analytics';
import { getCampaignStatus, type CampaignStatus } from '@/lib/account-api';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import type { ModelAccessEntry } from '@/lib/types';

export const CAMPAIGN_MILESTONE_LABELS: Record<string, string> = {
  signup: 'Account created',
  first_agent: 'First agent connected (launcher/CLI)',
  first_conversation: 'First conversation',
  second_agent: 'Second agent type connected (launcher/CLI)',
  second_agent_response: 'Second agent replied',
};

const SEEN_KEY = 'oa_campaign_seen_milestones';
const POLL_MS = 45_000;

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export function CampaignMilestoneToasts({ idToken }: { idToken: string }) {
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      if (stopped || document.hidden) return schedule();
      try {
        const s = await getCampaignStatus(idToken);
        if (stopped) return;
        if (!s.enabled) return; // self-hosted / campaign off — stop polling
        const cap = s.capUsd ?? 100;
        const total = s.totalGrantedUsd ?? 0;
        const granted: { key: string; amount: number }[] = (s.milestones || [])
          .filter((m) => m.grantedAt)
          .map((m) => ({ key: m.key, amount: m.amountUsd }));
        for (let i = 1; i <= (s.daily?.daysGranted ?? 0); i++) {
          granted.push({ key: `daily#${i}`, amount: s.daily?.grantUsd ?? 10 });
        }

        // First observation ever (no stored baseline): record without
        // toasting, so returning users aren't spammed with history.
        const firstRun = seenRef.current === null && localStorage.getItem(SEEN_KEY) === null;
        const seen = seenRef.current ?? loadSeen();
        const fresh = granted.filter((g) => !seen.has(g.key));
        granted.forEach((g) => seen.add(g.key));
        seenRef.current = seen;
        localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen)));

        if (!firstRun) {
          for (const g of fresh) {
            const label = g.key.startsWith('daily#')
              ? `Daily active bonus (day ${g.key.slice(6)})`
              : CAMPAIGN_MILESTONE_LABELS[g.key] || g.key;
            toast.success(`🎉 +$${g.amount} API credits unlocked`, {
              description: `${label} — $${total % 1 ? total.toFixed(2) : total} of $${cap} unlocked`,
              duration: 8000,
            });
          }
        }
      } catch {
        /* transient — try again next tick */
      }
      schedule();
    };

    const schedule = () => {
      if (!stopped) timer = setTimeout(check, POLL_MS);
    };
    const onVisible = () => {
      if (!document.hidden && !stopped) {
        if (timer) clearTimeout(timer);
        check();
      }
    };

    check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [idToken]);

  return null;
}

/** "Connect an agent, earn credits" banner for the Connect view. */
export function CampaignConnectHint({ idToken }: { idToken: string | null }) {
  const t = useT();
  const [status, setStatus] = useState<CampaignStatus | null>(null);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    getCampaignStatus(idToken)
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [idToken]);

  if (!status?.enabled) return null;
  const granted = new Set((status.milestones || []).filter((m) => m.grantedAt).map((m) => m.key));

  let text: string | null = null;
  if (!granted.has('first_agent')) {
    text = t('campaign.connectFirstAgent');
  } else if (!granted.has('second_agent')) {
    text = t('campaign.connectSecondAgent');
  }
  if (!text) return null;

  // A standing nudge, not an alert: it sits above the thread for as long as the
  // milestone is unclaimed, so it reads as a tinted note in the surrounding
  // surface rather than the saturated full-width slab it used to be. The accent
  // survives on the icon and the border, which is enough to mark it as a reward.
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-emerald-700 dark:text-emerald-400">
      <Gift className="mt-0.5 size-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

/** Agent types whose config form offers the one-click promo-credits setup.
    All of them speak the OpenAI protocol and accept any compatible endpoint
    via their LLM_* mapping, so the campaign gateway can back them directly. */
export const CAMPAIGN_PROMO_AGENT_TYPES = new Set([
  'codex',
  'pi',
  'hermes',
  'openclaw',
  'deepseek',
  'opencode',
  'kimi',
]);

/**
 * One-click "use my OpenAgents promo credits" row for the agent-config form.
 *
 * Sits under the Model-access picker. When the credits campaign is live and
 * the user's promo key still has budget, one click either selects the saved
 * access that already points at the campaign gateway or creates it (custom
 * OpenAI-compatible provider, gateway /v1 base URL, the user's promo key) —
 * no copy-pasting between Settings → API credits and this form.
 *
 * Renders nothing when the campaign is off (self-hosted), the key is
 * exhausted, or the gateway access is already the selected one.
 */
export function CampaignPromoAccess({
  agentType,
  accesses,
  selectedAccessId,
  onUse,
}: {
  agentType: string;
  accesses: ModelAccessEntry[] | null;
  selectedAccessId?: string;
  onUse: (entry: ModelAccessEntry, created: boolean) => void;
}) {
  const t = useT();
  const { idToken } = useOpenAgentsAuth();
  const [status, setStatus] = useState<CampaignStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    getCampaignStatus(idToken)
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [idToken]);

  if (!status?.enabled) return null;
  const apiKey = status.apiKey;
  const gatewayUrl = status.gatewayUrl;
  if (!apiKey || !gatewayUrl) return null;
  if (status.usage?.isActive === false) return null; // exhausted — a dead key helps nobody

  const base = `${gatewayUrl.replace(/\/+$/, '')}/v1`;
  const existing = (accesses || []).find((a) => (a.baseUrl || '').replace(/\/+$/, '') === base);
  if (existing && existing.id === selectedAccessId) return null; // already in use

  const remaining = status.usage
    ? Math.max(0, Math.round((status.usage.costLimitUsd - status.usage.costUsdUsed) * 100) / 100)
    : null;

  const use = async () => {
    if (existing) {
      capture('campaign_promo_access_used', { agent: agentType, created: false });
      onUse(existing, false);
      return;
    }
    setBusy(true);
    try {
      const entry = await workspaceApi.createModelAccess({
        provider: 'custom',
        apiKey,
        label: 'OpenAgents credits',
        baseUrl: base,
      });
      capture('campaign_promo_access_used', { agent: agentType, created: true });
      toast.success(t('connect.byokPromoAdded'));
      onUse(entry, true);
    } catch {
      toast.error(t('connect.byokPromoFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/40">
      <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-emerald-800 dark:text-emerald-300">
        🎁{' '}
        {remaining !== null
          ? t('connect.byokPromoHintRemaining', { remaining: remaining % 1 ? remaining.toFixed(2) : String(remaining) })
          : t('connect.byokPromoHint')}
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={use}
        disabled={busy}
        className="h-8 shrink-0 border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-800 dark:bg-transparent dark:text-emerald-300 dark:hover:bg-emerald-900/40"
      >
        {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Gift className="mr-1.5 size-3.5" />}
        {t('connect.byokPromoCta')}
      </Button>
    </div>
  );
}
