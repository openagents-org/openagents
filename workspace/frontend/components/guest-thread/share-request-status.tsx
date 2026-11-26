'use client';

import { useState } from 'react';
import { Check, Clock, Lock, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ShareRequestStatus } from '@/lib/share-requests';

export type DecideOutcome = 'ok' | 'conflict' | 'failed';
export type DecideRequest = (requestId: string, decision: 'approve' | 'decline') => Promise<DecideOutcome>;

/**
 * Where a guest's held request stands, under their message. The owner gets
 * the workspace approval card (Decline / Approve) while it waits; everyone
 * else, and the owner once decided, a quiet status badge.
 */
export function ShareRequestStatusView({ requestId, status, guestName, agentName, ownerName, onDecide, pendingLabel }: {
  requestId: string;
  status: ShareRequestStatus;
  guestName: string;
  agentName: string;
  ownerName: string;
  /** Owner only: record a decision. */
  onDecide?: DecideRequest;
  /** Replaces "Waiting for <owner>'s approval" (e.g. in the owner's own workspace). */
  pendingLabel?: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState<null | 'approve' | 'decline'>(null);
  const [error, setError] = useState<string | null>(null);

  if (status === 'pending' && onDecide) {
    const decide = async (decision: 'approve' | 'decline') => {
      setBusy(decision); setError(null);
      const outcome = await onDecide(requestId, decision);
      setBusy(null);
      if (outcome === 'conflict') setError(t('shareJam.requestAlreadyDecided'));
      else if (outcome === 'failed') setError(t('shareJam.requestFailed'));
    };
    return (
      <Item variant="outline" size="sm" className="mt-2 max-w-xl flex-wrap items-start border-warning/60" data-share-request="pending" data-share-request-id={requestId}>
        <ItemMedia variant="icon" className="text-warning"><Lock aria-hidden="true" /></ItemMedia>
        <ItemContent className="min-w-48">
          <ItemTitle className="line-clamp-none">{t('shareJam.requestTitle', { guest: guestName, agent: agentName })}</ItemTitle>
          <ItemDescription className="line-clamp-none text-xs">{t('shareJam.requestWaitingYou', { agent: agentName })}</ItemDescription>
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        </ItemContent>
        <ItemActions className="ms-auto">
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide('decline')} data-share-decide="decline">
            {busy === 'decline' ? <Spinner data-icon="inline-start" /> : <X data-icon="inline-start" />}{t('shareJam.decline')}
          </Button>
          <Button size="sm" disabled={busy !== null} onClick={() => void decide('approve')} data-share-decide="approve">
            {busy === 'approve' ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}{t('shareJam.approve')}
          </Button>
        </ItemActions>
      </Item>
    );
  }

  const label = status === 'pending' ? (pendingLabel ?? t('guestThread.waitingApproval', { owner: ownerName }))
    : status === 'approved' ? t('guestThread.requestApproved') : t('guestThread.requestDeclined');
  const Icon = status === 'pending' ? Clock : status === 'approved' ? Check : X;
  return (
    <div className="mt-2" data-share-request={status} data-share-request-id={requestId}>
      <Badge variant="outline" className={cn('max-w-full', status === 'pending' ? 'border-warning/40 text-warning' : status === 'approved' ? 'text-success' : 'text-muted-foreground')} role="status">
        <Icon aria-hidden="true" />{label}
      </Badge>
    </div>
  );
}
