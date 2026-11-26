'use client';

import { useEffect } from 'react';
import { Eye } from 'lucide-react';
import { GuestLinkPanel, type GuestLinksLoad } from '@/components/chat/guest-link-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';
import type { GuestLink, GuestLinksClient } from '@/lib/guest-links';
import { useT } from '@/lib/i18n';

/**
 * The owner page's guest link controls (copy, expiry, turn off, new link),
 * in the same dialog frame as the workspace's Share dialog.
 */
/** A part of the guest-link settings the dialog can open at. */
export type GuestLinkSection = 'access' | 'requests' | 'post' | 'agents' | 'expiry' | 'guests';

export function GuestLinkDialog({ open, onOpenChange, channel, agentName, links, error, setLinks, client, focus, onPreview }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: string;
  agentName: string | null;
  links: GuestLink[] | null;
  error: GuestLinksLoad['error'];
  setLinks: (update: (links: GuestLink[]) => GuestLink[]) => void;
  client: GuestLinksClient;
  /** Open scrolled to (and highlighting) this part. */
  focus?: GuestLinkSection | null;
  /** "Preview as guest". */
  onPreview?: () => void;
}) {
  const t = useT();
  // Bring the part the owner clicked into view once the panel has rendered it.
  useEffect(() => {
    if (!open || !focus) return;
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.querySelector<HTMLElement>(`[data-guest-link-section="${focus}"]`);
      if (el || ++tries > 20) {
        clearInterval(timer);
        if (!el) return;
        el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        el.setAttribute('data-focused', '');
        setTimeout(() => el.removeAttribute('data-focused'), 1600);
      }
    }, 50);
    return () => clearInterval(timer);
  }, [open, focus, links]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-owner-guest-link-dialog="">
        <DialogHeader>
          <DialogTitle>{t('shareJam.guestLinkHeading')}</DialogTitle>
          <DialogDescription>{t('shareJam.guestLinkDescription')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3 [&_[data-focused]]:rounded-lg [&_[data-focused]]:ring-2 [&_[data-focused]]:ring-ring/50" data-owner-guest-link="">
          <GuestLinkPanel channel={channel} agentName={agentName} links={links} error={error} setLinks={setLinks} client={client} />
        </DialogBody>
        <DialogFooter>
          {onPreview && <Button variant="ghost" className="sm:mr-auto" onClick={onPreview} data-guest-link-preview=""><Eye data-icon="inline-start" />{t('shareJam.previewAsGuest')}</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
