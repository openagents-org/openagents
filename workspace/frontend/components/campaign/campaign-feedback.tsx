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
import { toast } from 'sonner';
import { getCampaignStatus, type CampaignStatus } from '@/lib/account-api';

export const CAMPAIGN_MILESTONE_LABELS: Record<string, string> = {
  signup: 'Account created',
  first_agent: 'First agent connected',
  first_conversation: 'First conversation',
  second_agent: 'Second agent type connected',
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
    text = 'Connect your first agent to unlock +$20 in free API credits.';
  } else if (!granted.has('second_agent')) {
    text = 'Connect an agent of a different type to unlock +$10 more in API credits.';
  }
  if (!text) return null;

  return (
    <div className="mx-4 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
      🎁 {text}
    </div>
  );
}
