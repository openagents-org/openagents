'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { QrcodeIcon } from '@/components/icons/qrcode-icon';
import { listAccountWorkspaces } from '@/lib/account-api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';

/**
 * Where a scannable link has to point. `window.location.origin` is right for
 * every real deployment, but on localhost it produces a URL no phone can open —
 * fall back to the hosted app there, the same localhost carve-out
 * `lib/auth-redirects.ts` makes.
 */
const HOSTED_ORIGIN = 'https://workspace.openagents.org';

function shareOrigin(): string {
  if (typeof window === 'undefined') return HOSTED_ORIGIN;
  return window.location.hostname === 'localhost' ? HOSTED_ORIGIN : window.location.origin;
}

interface QrcodeMenuProps {
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

/**
 * Rail action that opens the workspace's join link as a QR code — the same
 * `/{slug}?token={token}` link the Membership Home tiles use, so scanning it on
 * a phone lands in this workspace already authorised.
 */
export function QrcodeMenu({ side = 'right', align = 'end' }: QrcodeMenuProps = {}) {
  const { workspace, token } = useWorkspace();
  const { idToken } = useOpenAgentsAuth();
  const params = useParams<{ workspaceId?: string }>();
  const t = useT();
  const [open, setOpen] = useState(false);
  // Read off `window` rather than `useSearchParams`, which opts the whole rail
  // into client-side bailout the moment it is called.
  const [urlToken, setUrlToken] = useState('');
  // Only needed for the one case the page itself cannot answer: a signed-in
  // user who opened the workspace without a `?token=` link, whose share token
  // lives in their membership list.
  const [fetchedToken, setFetchedToken] = useState('');

  useEffect(() => {
    setUrlToken(new URLSearchParams(window.location.search).get('token') || '');
  }, []);

  // The route segment IS the slug and `?token=` IS the token, so the link is
  // built from what is already on screen — no backend round-trip, and it still
  // works when the workspace fetch is slow or failing.
  const slug = params?.workspaceId || workspace?.slug || '';
  const shareToken = urlToken || token || fetchedToken;

  useEffect(() => {
    if (!open || shareToken || !idToken || !slug) return;
    let cancelled = false;
    listAccountWorkspaces(idToken)
      .then((list) => {
        if (cancelled) return;
        const match = list.find((w) => w.slug === slug || w.workspaceId === slug);
        if (match?.token) setFetchedToken(match.token);
      })
      .catch(() => {
        /* best-effort — the dialog falls back to its unavailable state */
      });
    return () => {
      cancelled = true;
    };
  }, [open, shareToken, idToken, slug]);

  const shareUrl = slug && shareToken ? `${shareOrigin()}/${slug}?token=${shareToken}` : '';

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        // Fallback for in-app browsers / insecure contexts without the Clipboard API
        const ta = document.createElement('textarea');
        ta.value = shareUrl;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast.success(t('qrcode.copied'));
    } catch {
      toast.error(t('qrcode.copyFailed'));
    }
  }, [shareUrl, t]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t('qrcode.trigger')}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <QrcodeIcon />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} align={align}>
          {t('qrcode.trigger')}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('qrcode.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('qrcode.dialogDescription')}</DialogDescription>
          </DialogHeader>

          {shareUrl ? (
            <div className="flex flex-col items-center gap-3 pb-2">
              {/* The code keeps a white quiet zone in both themes — inverting it
                  for dark mode is what breaks scanners. */}
              <button
                type="button"
                onClick={handleCopy}
                title={t('qrcode.clickToCopy')}
                className="rounded-lg bg-white p-4 ring-1 ring-border transition-transform hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {/* `marginSize` is the spec's 4-module quiet zone, in modules —
                    dropping it leaves scanners with nothing to lock onto once
                    the dialog behind it is dark. */}
                <QRCodeSVG value={shareUrl} size={200} level="M" marginSize={4} />
              </button>
              <p className="text-muted-foreground text-xs">{t('qrcode.clickToCopy')}</p>
            </div>
          ) : (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {t('qrcode.unavailable')}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
