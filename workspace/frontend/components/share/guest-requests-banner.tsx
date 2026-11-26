'use client';

import { useState } from 'react';
import { Check, Clock, X } from 'lucide-react';
import { STRIP } from '@/components/chat/chat-view-banners';
import { HumanAvatarFace } from '@/components/chat/human-avatar-face';
import type { DecideOutcome, DecideRequest } from '@/components/guest-thread/share-request-status';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { guestAvatarSeed } from '@/lib/guest-thread';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** A guest's request waiting for the owner (the jam and workspace APIs return the same shape). */
export interface PendingGuestRequest {
  id: string;
  guest: { id: string; name: string };
  messageId: string;
  content: string;
}

/**
 * "N guest requests waiting" as a thread banner strip, with Review opening the
 * list to approve or decline each one. Hidden while nothing waits.
 */
export function GuestRequestsBanner({ requests, onDecide, lead, className }: {
  requests: PendingGuestRequest[];
  onDecide: DecideRequest;
  /** Phone only: a short note before the count (the agent's state, when its own strip is folded in). */
  lead?: string | null;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (requests.length === 0) return null;
  return (
    <Alert role="status" className={cn(STRIP, 'border-warning/30 bg-warning/10 text-warning', className)} data-guest-requests={requests.length}>
      <Clock />
      <AlertDescription className="text-xs font-medium text-warning">
        {lead && <span className="sm:hidden" data-guest-requests-lead="">{lead} · </span>}
        {t('share.guestRequestsWaiting', { count: requests.length })}
      </AlertDescription>
      <AlertAction>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="xs" variant="outline" className="bg-background" data-guest-requests-review="">{t('share.guestRequestsReview')}</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 max-w-[calc(100vw-1rem)]" aria-label={t('share.guestRequestsTitle')} data-guest-requests-list="">
            <h4 className="px-1 text-sm font-medium">{t('share.guestRequestsTitle')}</h4>
            <ItemGroup className="no-scrollbar max-h-80 gap-1 overflow-y-auto">
              {requests.map((request) => <RequestRow key={request.id} request={request} onDecide={onDecide} />)}
            </ItemGroup>
          </PopoverContent>
        </Popover>
      </AlertAction>
    </Alert>
  );
}

function RequestRow({ request, onDecide }: { request: PendingGuestRequest; onDecide: DecideRequest }) {
  const t = useT();
  const [busy, setBusy] = useState<null | 'approve' | 'decline'>(null);
  const [outcome, setOutcome] = useState<DecideOutcome | null>(null);
  const decide = async (decision: 'approve' | 'decline') => {
    setBusy(decision); setOutcome(null);
    const result = await onDecide(request.id, decision);
    setBusy(null);
    setOutcome(result);
  };
  return (
    <Item size="xs" className="flex-wrap items-start px-1" data-guest-request={request.id}>
      <ItemMedia><HumanAvatarFace seed={guestAvatarSeed(request.guest.id)} /></ItemMedia>
      <ItemContent className="min-w-40">
        <ItemTitle className="truncate">{t('share.requestFrom', { guest: request.guest.name })}</ItemTitle>
        <ItemDescription className="line-clamp-2 wrap-break-word" title={request.content}>{request.content}</ItemDescription>
        {outcome === 'conflict' && <p className="text-xs text-muted-foreground" role="status">{t('share.requestAlreadyDecided')}</p>}
        {outcome === 'failed' && <p className="text-xs text-destructive" role="alert">{t('share.requestFailed')}</p>}
      </ItemContent>
      <ItemActions className="ms-auto gap-1">
        <Button size="xs" variant="outline" disabled={busy !== null} onClick={() => void decide('decline')} aria-label={`${t('share.decline')} · ${request.guest.name}`} data-guest-request-decide="decline">
          {busy === 'decline' ? <Spinner data-icon="inline-start" /> : <X data-icon="inline-start" />}{t('share.decline')}
        </Button>
        <Button size="xs" disabled={busy !== null} onClick={() => void decide('approve')} aria-label={`${t('share.approve')} · ${request.guest.name}`} data-guest-request-decide="approve">
          {busy === 'approve' ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}{t('share.approve')}
        </Button>
      </ItemActions>
    </Item>
  );
}
