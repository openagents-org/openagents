'use client';

/**
 * Permission model v1.1 — "Share…" for an owned artifact (file or knowledge
 * entry): pick people / agents / groups, see what the grant unlocks, grant;
 * list and revoke existing grants; and, for whoever can manage it, flip the
 * item between Private / Public (/ Inherit from thread for files).
 *
 * Exposed as a body (`ArtifactShareContent`), a popover with its own trigger
 * (`ArtifactSharePopover`, for headers) and a controlled dialog
 * (`ArtifactShareDialog`, for list-row menus where a popover has no anchor).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bot, Globe, Loader2, Lock, MessagesSquare, Share2, User, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GranteePicker } from '@/components/sharing/grantee-picker';
import { accessApi, type Grantee, type GranteeKind, type GrantPreviewItem, type ResourceGrant } from '@/lib/access-stubs';
import { useFormatters, useT } from '@/lib/i18n';
import type { ArtifactVisibility } from '@/lib/types';
import { visibilityBadgeFor, type ArtifactKind } from '@/lib/artifact-access';
import { cn } from '@/lib/utils';
import { ArtifactVisibilityBadge } from './artifact-access-badge';

export interface ArtifactShareProps {
  kind: ArtifactKind;
  id: string;
  name: string;
  visibility: ArtifactVisibility | null | undefined;
  effectiveVisibility?: ArtifactVisibility | null;
  /** Owner / admin / `share` right — shows the visibility switcher. */
  canManage: boolean;
  /** Files attached to a thread may also inherit (visibility null). */
  canInherit?: boolean;
  onVisibilityChange?: (visibility: ArtifactVisibility | null) => Promise<void> | void;
}

function GranteeIcon({ kind }: { kind: GranteeKind }) {
  const Icon = kind === 'agent' ? Bot : kind === 'group' ? Users : User;
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" />;
}

export function ArtifactShareContent({
  kind, id, name, visibility, effectiveVisibility, canManage, canInherit = false, onVisibilityChange,
}: ArtifactShareProps) {
  const t = useT();
  const { formatDate } = useFormatters();

  // ── existing grants ──
  const [grants, setGrants] = useState<ResourceGrant[] | null>(null);
  const loadGrants = useCallback(async () => {
    try {
      setGrants(await accessApi.listGrants(kind, id));
    } catch {
      setGrants([]);
      toast.error(t('artifactAccess.grantsLoadFailed'));
    }
  }, [kind, id, t]);
  useEffect(() => { loadGrants(); }, [loadGrants]);

  const revoke = async (grant: ResourceGrant) => {
    setGrants((prev) => prev?.filter((g) => g.id !== grant.id) ?? prev);
    try {
      await accessApi.revokeGrant(grant.id);
      toast.success(t('artifactAccess.revoked'));
    } catch {
      toast.error(t('artifactAccess.revokeFailed'));
      loadGrants();
    }
  };

  // ── new grants ──
  const [picked, setPicked] = useState<Grantee[]>([]);
  const [sharing, setSharing] = useState(false);
  const [preview, setPreview] = useState<{ for: string; items: GrantPreviewItem[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Preview follows the most recently picked grantee — enough to answer
  // "what does this unlock" without a request per chip.
  const last = picked[picked.length - 1];
  useEffect(() => {
    if (!last) { setPreview(null); return; }
    const key = `${last.kind}:${last.id}`;
    let cancelled = false;
    setPreviewLoading(true);
    accessApi.previewGrant(kind, id, last.kind, last.id)
      .then((items) => { if (!cancelled) setPreview({ for: key, items }); })
      .catch(() => { if (!cancelled) setPreview({ for: key, items: [] }); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [kind, id, last?.kind, last?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const exclude = useMemo(() => (grants ?? []).map((g) => g.grantee_id), [grants]);

  const share = async () => {
    if (picked.length === 0 || sharing) return;
    setSharing(true);
    let done = 0;
    for (const g of picked) {
      try {
        await accessApi.createGrant({
          resource_kind: kind,
          resource_id: id,
          grantee_kind: g.kind,
          grantee_id: g.id,
          rights: ['read'],
        });
        done += 1;
      } catch {
        toast.error(t('artifactAccess.shareFailed', { grantee: g.label }));
      }
    }
    setSharing(false);
    if (done > 0) {
      toast.success(t('artifactAccess.shared', { count: done }));
      setPicked([]);
      await loadGrants();
    }
  };

  // ── visibility ──
  const [switching, setSwitching] = useState(false);
  const current = visibilityBadgeFor(kind, visibility, effectiveVisibility);
  const setVisibility = async (next: ArtifactVisibility | null) => {
    if (!onVisibilityChange || switching) return;
    setSwitching(true);
    try {
      await onVisibilityChange(next);
      toast.success(t('artifactAccess.visibilityUpdated'));
    } catch {
      toast.error(t('artifactAccess.visibilityUpdateFailed'));
    } finally {
      setSwitching(false);
    }
  };

  const visOption = (value: ArtifactVisibility | null, badge: 'private' | 'public' | 'inherit', label: string, Icon: typeof Lock) => (
    <button
      key={badge}
      type="button"
      disabled={switching}
      onClick={() => setVisibility(value)}
      aria-pressed={current === badge}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors',
        current === badge ? 'border-primary/40 bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted',
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );

  return (
    <div className="space-y-4 text-sm">
      {/* Visibility */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('artifactAccess.visibility')}</h4>
          <ArtifactVisibilityBadge kind={kind} visibility={visibility} effectiveVisibility={effectiveVisibility} />
        </div>
        {canManage && onVisibilityChange && (
          <div className="flex gap-1.5">
            {visOption('private', 'private', t('artifactAccess.makePrivate'), Lock)}
            {visOption('public', 'public', t('artifactAccess.makePublic'), Globe)}
            {canInherit && visOption(null, 'inherit', t('artifactAccess.inheritFromThread'), MessagesSquare)}
          </div>
        )}
      </section>

      {/* Share with… */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('artifactAccess.shareWith')}</h4>
        <GranteePicker value={picked} onChange={setPicked} exclude={exclude} />
        {picked.length > 0 && (
          <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
            {previewLoading ? (
              <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" />{t('artifactAccess.previewLoading')}</span>
            ) : (
              <>
                <p className="font-medium text-foreground/80">{t('artifactAccess.previewTitle')}</p>
                {preview && preview.items.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {preview.items.slice(0, 5).map((item) => (
                      <li key={`${item.kind}:${item.id}`} className="truncate">· {item.title || item.id}</li>
                    ))}
                    {preview.items.length > 5 && <li>· +{preview.items.length - 5}</li>}
                  </ul>
                ) : (
                  <p className="mt-0.5">{t('artifactAccess.previewNone')}</p>
                )}
              </>
            )}
          </div>
        )}
        <Button size="sm" onClick={share} disabled={sharing || picked.length === 0} className="w-full">
          {sharing ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
          {sharing ? t('artifactAccess.sharing') : t('artifactAccess.shareAction')}
        </Button>
      </section>

      {/* Who has access */}
      <section className="space-y-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('artifactAccess.grantsTitle')}</h4>
        {grants === null ? (
          <p className="text-xs text-muted-foreground">{t('artifactAccess.grantsLoading')}</p>
        ) : grants.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('artifactAccess.grantsEmpty')}</p>
        ) : (
          <ul className="max-h-48 space-y-0.5 overflow-y-auto">
            {grants.map((g) => (
              <li key={g.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50">
                <GranteeIcon kind={g.grantee_kind} />
                <span className="min-w-0 flex-1 truncate text-xs">{g.grantee_label || g.grantee_id}</span>
                {g.expires_at && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {t('agentAccess.expiresOn', { date: formatDate(g.expires_at) })}
                  </span>
                )}
                {canManage && (
                  <Button
                    variant="ghost"
                    mode="icon"
                    size="sm"
                    onClick={() => revoke(g)}
                    aria-label={t('artifactAccess.revoke')}
                    title={t('artifactAccess.revoke')}
                    className="size-6 text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <span className="sr-only">{t('artifactAccess.shareTitle', { name })}</span>
    </div>
  );
}

/** Header-side share: a button that opens the share body in a popover. */
export function ArtifactSharePopover({ trigger, align = 'end', ...props }: ArtifactShareProps & { trigger?: ReactNode; align?: 'start' | 'center' | 'end' }) {
  const t = useT();
  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" aria-label={t('artifactAccess.share')} title={t('artifactAccess.share')}>
            <Share2 className="size-4" />
            <span className="hidden sm:inline">{t('artifactAccess.share')}</span>
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 p-3" onClick={(e) => e.stopPropagation()}>
        <ArtifactShareContent {...props} />
      </PopoverContent>
    </Popover>
  );
}

/** Menu-launched share: controlled dialog for list rows and grid tiles. */
export function ArtifactShareDialog({ open, onOpenChange, ...props }: ArtifactShareProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="truncate">{t('artifactAccess.shareTitle', { name: props.name })}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <ArtifactShareContent {...props} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
