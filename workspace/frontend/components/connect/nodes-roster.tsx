'use client';
import type { ReactNode } from 'react';
import { Plus, RefreshCw, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * The devices screen around its cards: heading, refresh and "connect
 * another", and what stands in for the list while it loads, when it failed
 * and before the first device.
 */
export function NodesRoster({
  empty,
  loading,
  loadFailed,
  pairingLoading,
  onConnectAnother,
  onGenerate,
  onRefresh,
  children,
}: {
  empty: boolean;
  loading: boolean;
  loadFailed: boolean;
  pairingLoading: boolean;
  onConnectAnother: () => void;
  onGenerate: () => void;
  onRefresh: () => void;
  /** One card per device. */
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="p-6 flex flex-col gap-5 max-w-2xl mx-auto w-full">
      {/* Heading + refresh */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-lg font-medium">{t('connect.nodeHeading')}</h3>
          <p className="text-sm text-muted-foreground">{t('connect.nodeSubtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!empty && (
            <Button variant="outline" onClick={onConnectAnother}>
              <Plus data-icon="inline-start" />{t('connect.nodeConnectAnother')}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={onRefresh}
            title={t('connect.nodeRefresh')}
            aria-label={t('connect.nodeRefresh')}
          >
            <RefreshCw className={cn(loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Node list / empty state */}
      {loading && empty ? (
        <div role="status" className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
          <Spinner />{t('common.loading')}
        </div>
      ) : loadFailed && empty ? (
        <Empty role="alert" data-testid="nodes-load-failed" className="border">
          <EmptyHeader>
            <EmptyDescription>{t('connect.nodeListLoadFailed')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={onRefresh}>
              <RefreshCw data-icon="inline-start" />{t('common.retry')}
            </Button>
          </EmptyContent>
        </Empty>
      ) : empty ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Server /></EmptyMedia>
            <EmptyTitle>{t('connect.nodeEmptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('connect.nodeEmptyBody')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">{children}</div>
      )}

      {/* A new workspace can start pairing without a device roster. */}
      {empty && !loadFailed && (
        <Button onClick={onGenerate} disabled={pairingLoading} className="w-full" size="lg">
          {pairingLoading ? (
            <><Spinner data-icon="inline-start" />{t('connect.nodeGenerating')}</>
          ) : (
            <><Plus data-icon="inline-start" />{t('connect.nodeConnect')}</>
          )}
        </Button>
      )}
    </div>
  );
}
