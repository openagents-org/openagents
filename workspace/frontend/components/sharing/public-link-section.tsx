'use client';

/**
 * "Anyone with the link" for an artifact (a file, web projects included, or a
 * knowledge document). Workspace links only open for members who can already
 * read it, which is no use for someone outside the workspace; this mints a
 * token link (/share/artifact/<token>) that needs no sign-in, optionally
 * expiring, and turns it off again.
 *
 * The link serves a snapshot taken when it was made. "Update to current
 * version" takes a new one and keeps the same link, so an agent rewriting the
 * file never changes what the public sees without a person saying so.
 */

import { useCallback, useEffect, useState } from 'react';
import { Copy, Link2, Loader2, Link2Off, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { workspaceApi } from '@/lib/api';
import { useFormatters, useT } from '@/lib/i18n';
import { publicShareUrl } from '@/lib/share-origin';
import type { PublicShareKind, PublicShareState } from '@/lib/types';

type Expiry = 'never' | '1' | '7' | '30' | 'custom';

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
}

/** YYYY-MM-DD in local time, for a date input. */
function dateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The chosen expiry as an ISO timestamp, null for never. A date means the
 *  end of that day where the person picking it is. */
export function expiryTimestamp(choice: Expiry, customDate: string, now = new Date()): string | null {
  if (choice === 'never') return null;
  if (choice === 'custom') {
    const [y, m, d] = customDate.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 23, 59, 59).toISOString();
  }
  return new Date(now.getTime() + Number(choice) * 86_400_000).toISOString();
}

export function PublicLinkSection({ kind, id, webPage = false }: { kind: PublicShareKind; id: string; webPage?: boolean }) {
  const t = useT();
  const { formatDate, formatDateTime } = useFormatters();
  const [state, setState] = useState<PublicShareState | null>(null);
  const [busy, setBusy] = useState(false);
  const [expiry, setExpiry] = useState<Expiry>('never');
  const [customDate, setCustomDate] = useState(() => dateInputValue(new Date(Date.now() + 7 * 86_400_000)));

  const load = useCallback(async () => {
    try {
      const next = await workspaceApi.getPublicShare(kind, id);
      setState(next);
      // An existing link opens on the expiry it has, so updating keeps it.
      if (next.link?.expires_at) {
        setExpiry('custom');
        setCustomDate(dateInputValue(new Date(next.link.expires_at)));
      }
    } catch {
      setState({ link: null, can_manage: false });
    }
  }, [kind, id]);
  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<PublicShareState>, done: (next: PublicShareState) => Promise<void> | void) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await action();
      setState(next);
      await done(next);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t('artifactAccess.linkFailed'));
    } finally {
      setBusy(false);
    }
  };

  // The server says where the link lives (the share domain's own page);
  // older servers only send the token, which opens here.
  const linkUrl = (next: PublicShareState) => next.link?.url || (next.link?.token ? publicShareUrl(next.link.token) : null);
  const publish = (refresh: boolean) => run(
    () => workspaceApi.createPublicShare(kind, id, expiryTimestamp(expiry, customDate)),
    async (next) => {
      if (refresh) { toast.success(t('artifactAccess.linkUpdated')); return; }
      // The link exists by now; a clipboard the browser refused is not a
      // failure to create it, and the copy button is right there.
      try {
        const url = linkUrl(next);
        if (url) await copy(url);
        toast.success(t('artifactAccess.linkCreated'));
      } catch {
        toast.warning(t('artifactAccess.linkCreatedCopyFailed'));
      }
    },
  );
  const revoke = () => run(() => workspaceApi.revokePublicShare(kind, id), () => {
    toast.success(t('artifactAccess.linkRevoked'));
  });
  const copyExisting = async () => {
    const url = state && linkUrl(state);
    if (!url) return;
    try {
      await copy(url);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('resourceLinks.copyFailed'));
    }
  };

  const heading = <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('artifactAccess.linkTitle')}</h4>;

  if (state === null) {
    return <section className="space-y-2">{heading}<p className="text-xs text-muted-foreground">{t('artifactAccess.grantsLoading')}</p></section>;
  }
  // Nothing to show someone who can't manage it and has no link to know about.
  if (!state.can_manage && !state.link) return null;
  if (!state.can_manage) {
    return <section className="space-y-2">{heading}<p className="text-xs text-muted-foreground">{t('artifactAccess.linkActiveReadOnly')}</p></section>;
  }

  const link = state.link;
  const customInvalid = expiry === 'custom' && (!customDate || new Date(expiryTimestamp('custom', customDate) || 0) <= new Date());
  const expiryPicker = (
    <div className="space-y-1.5" data-testid="public-link-expiry">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-muted-foreground">{t('artifactAccess.linkExpiry')}</span>
        <Select value={expiry} onValueChange={(v) => setExpiry(v as Expiry)}>
          <SelectTrigger aria-label={t('artifactAccess.linkExpiry')} className="h-8 min-w-0 flex-1 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="never">{t('artifactAccess.linkExpiryNever')}</SelectItem>
            <SelectItem value="1">{t('artifactAccess.linkExpiryDay')}</SelectItem>
            <SelectItem value="7">{t('artifactAccess.linkExpiryWeek')}</SelectItem>
            <SelectItem value="30">{t('artifactAccess.linkExpiryMonth')}</SelectItem>
            <SelectItem value="custom">{t('artifactAccess.linkExpiryCustom')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {expiry === 'custom' && (
        <Input
          type="date"
          aria-label={t('artifactAccess.linkExpiryDate')}
          value={customDate}
          min={dateInputValue(new Date(Date.now() + 86_400_000))}
          onChange={(event) => setCustomDate(event.target.value)}
          className="h-8 text-xs"
        />
      )}
    </div>
  );

  return (
    <section className="space-y-2">
      {heading}
      <p className="text-xs text-muted-foreground">{t('artifactAccess.linkHint')}</p>
      {webPage && <p className="text-xs text-muted-foreground">{t('artifactAccess.linkWebPageNote')}</p>}
      {link?.token ? (
        <>
          <p className="text-xs text-muted-foreground" data-testid="public-link-status">
            {link.snapshot_at && t('artifactAccess.linkSnapshot', { date: formatDateTime(link.snapshot_at) })}
            {' · '}
            {link.expires_at ? t('artifactAccess.linkExpiresOn', { date: formatDate(link.expires_at) }) : t('artifactAccess.linkNoExpiry')}
          </p>
          <div className="flex gap-1.5">
            <Button size="sm" className="flex-1" onClick={() => void copyExisting()} disabled={busy}>
              <Copy className="size-3.5" />
              {t('artifactAccess.linkCopy')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void revoke()} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2Off className="size-3.5" />}
              {t('artifactAccess.linkRevoke')}
            </Button>
          </div>
          {expiryPicker}
          <Button size="sm" variant="outline" className="w-full" onClick={() => void publish(true)} disabled={busy || customInvalid}>
            <RefreshCw className="size-3.5" />
            {t('artifactAccess.linkUpdate')}
          </Button>
        </>
      ) : (
        <>
          {expiryPicker}
          <Button size="sm" className="w-full" onClick={() => void publish(false)} disabled={busy || customInvalid}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
            {t('artifactAccess.linkCreate')}
          </Button>
        </>
      )}
    </section>
  );
}
