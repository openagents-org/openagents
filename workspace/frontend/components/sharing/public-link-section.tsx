'use client';

/**
 * "Anyone with the link" for a file. Workspace links only open for members
 * who can already read the file, which is no use for someone outside the
 * workspace; this mints a token link (/share/file/<token>) that needs no
 * sign-in, and turns it off again.
 */

import { useCallback, useEffect, useState } from 'react';
import { Copy, Link2, Loader2, Link2Off } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { publicFileUrl } from '@/lib/share-origin';
import type { FilePublicLinkState } from '@/lib/types';

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
}

export function PublicLinkSection({ fileId, unsupported = false }: { fileId: string; unsupported?: boolean }) {
  const t = useT();
  const [state, setState] = useState<FilePublicLinkState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await workspaceApi.getFilePublicLink(fileId));
    } catch {
      setState({ link: null, can_manage: false });
    }
  }, [fileId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<FilePublicLinkState>, done: (next: FilePublicLinkState) => Promise<void> | void) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await action();
      setState(next);
      await done(next);
    } catch {
      toast.error(t('artifactAccess.linkFailed'));
    } finally {
      setBusy(false);
    }
  };

  const create = () => run(() => workspaceApi.createFilePublicLink(fileId), async (next) => {
    // The link exists by now; a clipboard the browser refused is not a
    // failure to create it, and the copy button is right there.
    try {
      if (next.link?.token) await copy(publicFileUrl(next.link.token));
      toast.success(t('artifactAccess.linkCreated'));
    } catch {
      toast.warning(t('artifactAccess.linkCreatedCopyFailed'));
    }
  });
  const revoke = () => run(() => workspaceApi.revokeFilePublicLink(fileId), () => {
    toast.success(t('artifactAccess.linkRevoked'));
  });
  const copyExisting = async (token: string) => {
    try {
      await copy(publicFileUrl(token));
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
  if (unsupported && !state.link) {
    return <section className="space-y-2">{heading}<p className="text-xs text-muted-foreground">{t('artifactAccess.linkUnsupported')}</p></section>;
  }

  const token = state.link?.token;
  return (
    <section className="space-y-2">
      {heading}
      <p className="text-xs text-muted-foreground">{t('artifactAccess.linkHint')}</p>
      {token ? (
        <div className="flex gap-1.5">
          <Button size="sm" className="flex-1" onClick={() => void copyExisting(token)} disabled={busy}>
            <Copy className="size-3.5" />
            {t('artifactAccess.linkCopy')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void revoke()} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2Off className="size-3.5" />}
            {t('artifactAccess.linkRevoke')}
          </Button>
        </div>
      ) : (
        <Button size="sm" className="w-full" onClick={() => void create()} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
          {t('artifactAccess.linkCreate')}
        </Button>
      )}
    </section>
  );
}
