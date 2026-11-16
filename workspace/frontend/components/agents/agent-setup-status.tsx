'use client';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { CatalogState } from './agent-setup-types';

/**
 * What to show while the catalog is empty because it has not loaded: a
 * spinner, or the failure with a retry. Nothing once it has loaded.
 */
export function CatalogStateNotice({ state }: { state?: CatalogState }) {
  const t = useT();
  if (!state || state.status === 'ready') return null;
  if (state.status === 'loading') {
    return (
      <Empty role="status" className="border">
        <EmptyHeader>
          <EmptyMedia><Spinner /></EmptyMedia>
          <EmptyDescription>{t('connect.marketLoading')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Empty role="alert" className="border">
      <EmptyHeader>
        <EmptyDescription>{t('connect.marketLoadFailed')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={state.retry}>{t('connect.marketRetry')}</Button>
      </EmptyContent>
    </Empty>
  );
}

/** Derive the per-type detection status shown as a badge in the gallery.
 *  `onKey`: the agent being edited runs on a key of its own. */
export function runtimeStatus(rt: import('@/lib/types').NodeRuntime | undefined, onKey = false) {
  if (!rt) return 'unknown' as const;
  if (!rt.installed) return 'not_installed' as const;
  // `ready` also counts a key one agent of the type holds, which a new agent,
  // or one with no key of its own, never gets: the add form said a keyless
  // DeepSeek was ready, and it failed on its first message. A type with a
  // sign-in is ready on the sign-in alone, the only choice besides a key the
  // form offers it. Devices too old to say are judged on `ready`.
  if (rt.signedIn ?? rt.typeReady ?? rt.ready) return 'ready' as const;
  if (onKey && rt.reason !== 'version_incompatible') return 'ready' as const;
  return 'needs_login' as const;
}

// ── Marketplace building blocks (Add-agent gallery) ─────────────────────────
// Shared by the gallery (agent-setup-market) and the desktop app's compact
// picker (agent-setup-compact).

export type GalleryStatus = ReturnType<typeof runtimeStatus>;

export function marketStatusMeta(t: ReturnType<typeof useT>, status: GalleryStatus) {
  switch (status) {
    case 'ready':
      return { label: t('connect.nodeRuntimeReady'), dot: 'bg-success', text: 'text-success' };
    case 'needs_login':
      return { label: t('connect.nodeRuntimeNeedsLogin'), dot: 'bg-warning', text: 'text-warning' };
    default:
      return { label: t('connect.nodeRuntimeWillInstall'), dot: 'bg-muted-foreground/60', text: 'text-muted-foreground' };
  }
}

export function MarketStatusBadge({ status, checking, className }: { status: GalleryStatus; checking?: boolean; className?: string }) {
  const t = useT();
  if (checking) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium text-primary whitespace-nowrap', className)}>
        <Spinner className="size-2.5" />{t('connect.nodeChecking')}
      </span>
    );
  }
  const meta = marketStatusMeta(t, status);
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap', meta.text, className)}>
      <span className={cn('size-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}
