'use client';

import { GuestLinkPanel, type GuestLinksLoad } from '@/components/chat/guest-link-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';
import type { GuestLink, GuestLinksClient } from '@/lib/guest-links';
import { useT } from '@/lib/i18n';

/**
 * The owner room's guest link controls (copy, expiry, turn off, new link),
 * in the same dialog frame as the workspace's Share dialog.
 */
export function GuestLinkDialog({ open, onOpenChange, channel, agentName, links, error, setLinks, client }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: string;
  agentName: string | null;
  links: GuestLink[] | null;
  error: GuestLinksLoad['error'];
  setLinks: (update: (links: GuestLink[]) => GuestLink[]) => void;
  client: GuestLinksClient;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-owner-guest-link-dialog="">
        <DialogHeader>
          <DialogTitle>{t('shareRoom.guestLinkHeading')}</DialogTitle>
          <DialogDescription>{t('shareRoom.guestLinkDescription')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3" data-owner-guest-link="">
          <GuestLinkPanel channel={channel} agentName={agentName} links={links} error={error} setLinks={setLinks} client={client} />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
