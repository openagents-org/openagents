'use client';

import { useEffect, useState } from 'react';
import { Globe, RotateCcw, ExternalLink } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { BrowserView } from '@/components/browser/browser-view';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { workspaceApi } from '@/lib/api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import type { BrowserTab } from '@/lib/types';
import { browserFabricLiveUrl } from '@/lib/thread-browser';

export function BrowserArtifactPreview({ tabId, revision }: { tabId: string; revision: number }) {
  const { idToken } = useOpenAgentsAuth();
  const liveUrl = browserFabricLiveUrl(tabId);
  if (liveUrl) return <LinkedBrowserPreview key={`${liveUrl}:${revision}:${idToken}`} liveUrl={liveUrl} />;
  return <SavedBrowserPreview key={`${tabId}:${revision}:${idToken}`} tabId={tabId} />;
}

function LinkedBrowserPreview({ liveUrl }: { liveUrl: string }) {
  const { browserTabs, workspace } = useWorkspace();
  const t = useT();
  const [closed, setClosed] = useState<BrowserTab | null>(null);
  const [checking, setChecking] = useState(true);
  const active = browserTabs.find(tab => browserFabricLiveUrl(tab.liveUrl || '') === liveUrl);
  useEffect(() => {
    if (active) { setChecking(false); return; }
    let cancelled = false;
    setChecking(true);
    void workspaceApi.listBrowserTabs('closed').then(result => {
      if (!cancelled) setClosed(result.tabs.find(tab => browserFabricLiveUrl(tab.liveUrl || '') === liveUrl) || null);
    }).catch(() => {}).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [liveUrl, active?.id, workspace?.workspaceId]);
  if (active || closed) return <SavedBrowserPreview key={(active || closed)!.id} tabId={(active || closed)!.id} />;
  if (checking) return <div className="flex h-full items-center justify-center"><Spinner className="size-5" /></div>;
  return <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center">
    <Globe className="size-6 text-muted-foreground" />
    <h3 className="text-sm font-semibold">{t('artifactPanel.unlinkedBrowser')}</h3>
    <p className="text-sm text-muted-foreground">{t('artifactPanel.unlinkedBrowserHint')}</p>
    <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm underline">
      {t('artifactPanel.openOriginalBrowserLink')}<ExternalLink className="size-3.5" />
    </a>
  </div>;
}

function SavedBrowserPreview({ tabId }: { tabId: string }) {
  const t = useT();
  const { browserTabs, refreshBrowserTabs } = useWorkspace();
  const isListed = browserTabs.some(tab => tab.id === tabId);
  const [saved, setSaved] = useState<BrowserTab | null>(null);
  const [loading, setLoading] = useState(true);
  const [reopening, setReopening] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([workspaceApi.getBrowserTab(tabId), refreshBrowserTabs().catch(() => {})])
      .then(([tab]) => { if (active) setSaved(tab); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tabId, isListed, refreshBrowserTabs]);

  const reopen = async () => {
    setReopening(true);
    setError(false);
    try {
      const tab = await workspaceApi.reconnectBrowserTab(tabId, true);
      await refreshBrowserTabs();
      setSaved(tab);
    } catch {
      setError(true);
    } finally {
      setReopening(false);
    }
  };

  if (loading) return <div className="flex h-full items-center justify-center"><Spinner className="size-5 text-muted-foreground" /></div>;
  if (saved?.status === 'closed') return (
    <Empty className="h-full px-8 py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Globe /></EmptyMedia>
        <EmptyTitle>{t('artifactPanel.browserClosed')}</EmptyTitle>
        <EmptyDescription>{t('artifactPanel.browserClosedHint')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Item variant="outline" size="sm" className="w-full text-left">
          <ItemContent className="min-w-0">
            <ItemTitle className="w-full truncate">{saved.title || saved.url}</ItemTitle>
            <ItemDescription className="truncate text-xs" title={saved.url}>{saved.url}</ItemDescription>
          </ItemContent>
        </Item>
        {error && <p role="alert" className="text-sm text-destructive">{t('artifactPanel.reopenFailed')}</p>}
        <Button size="sm" disabled={reopening} onClick={() => void reopen()}>
          {reopening ? <Spinner data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
          {t('artifactPanel.reopenBrowser')}
        </Button>
      </EmptyContent>
    </Empty>
  );
  if (saved?.status === 'active' && isListed) return <BrowserView artifactTabId={tabId} />;
  return <p className="p-6 text-sm text-muted-foreground">{t('artifactPanel.unavailable')}</p>;
}
