'use client';

/**
 * Compact campaign-progress box for the bottom of the left sidebar.
 *
 * Shows mission progress only (no dollar figures — those live on the
 * Settings → API credits page this links to). Renders nothing when the
 * campaign is disabled (self-hosted), the user isn't signed in, or they've
 * already unlocked the full cap.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Gift, ChevronRight } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { getCampaignStatus, type CampaignStatus } from '@/lib/account-api';

export function CampaignSidebarCard() {
  const t = useT();
  const router = useRouter();
  const { workspace } = useWorkspace();
  const { idToken } = useOpenAgentsAuth();
  const [status, setStatus] = useState<CampaignStatus | null>(null);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    const fetchStatus = () => {
      getCampaignStatus(idToken)
        .then((s) => { if (!cancelled) setStatus(s); })
        .catch(() => {});
    };
    fetchStatus();
    // Refresh when the user returns to the tab so newly earned missions show.
    const onVisible = () => { if (!document.hidden) fetchStatus(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [idToken]);

  if (!idToken || !status?.enabled || !workspace?.slug) return null;
  const cap = status.capUsd ?? 100;
  const total = status.totalGrantedUsd ?? 0;
  if (total >= cap) return null; // campaign finished for this user

  const missions = status.milestones || [];
  const done = missions.filter((m) => m.grantedAt).length;
  const pct = missions.length ? Math.round((done / missions.length) * 100) : 0;
  const allMissionsDone = done === missions.length && missions.length > 0;

  return (
    <button
      onClick={() =>
        router.push(`/${workspace.slug}/settings/api-credits${window.location.search}`)
      }
      className="group mx-1 mb-0.5 rounded-lg border bg-background/60 p-2.5 text-left transition-colors hover:bg-accent"
      title={t('campaign.sidebarCta')}
    >
      <div className="flex items-center gap-1.5">
        <Gift className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {t('campaign.sidebarTitle')}
        </span>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        {t('campaign.sidebarProgress', { done, total: missions.length })}
        {' · '}
        {allMissionsDone ? t('campaign.sidebarDaily') : t('campaign.sidebarCta')}
      </div>
    </button>
  );
}
