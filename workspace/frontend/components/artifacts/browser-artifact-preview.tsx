'use client';

import { useEffect, useState } from 'react';
import { Globe, Loader2, RotateCcw } from 'lucide-react';
import { BrowserView } from '@/components/browser/browser-view';
import { Button } from '@/components/ui/button';
import { workspaceApi } from '@/lib/api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import type { BrowserTab } from '@/lib/types';

export function BrowserArtifactPreview({ tabId, revision }: { tabId: string; revision: number }) {
  const { idToken } = useOpenAgentsAuth();
  return <SavedBrowserPreview key={`${tabId}:${revision}:${idToken}`} tabId={tabId} />;
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
    void Promise.all([workspaceApi.getBrowserTab(tabId), refreshBrowserTabs()])
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

  if (loading) return <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (saved?.status === 'closed') return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
      <div className="mb-4 rounded-full bg-muted p-3"><Globe className="size-6 text-muted-foreground" /></div>
      <h3 className="text-sm font-semibold">{t('artifactPanel.browserClosed')}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{t('artifactPanel.browserClosedHint')}</p>
      <div className="mt-5 w-full max-w-sm rounded-lg border bg-muted/30 px-3 py-2.5 text-left">
        <p className="truncate text-sm font-medium">{saved.title || saved.url}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground" title={saved.url}>{saved.url}</p>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{t('artifactPanel.reopenFailed')}</p>}
      <Button className="mt-5 gap-2" size="sm" disabled={reopening} onClick={() => void reopen()}>
        {reopening ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
        {t('artifactPanel.reopenBrowser')}
      </Button>
    </div>
  );
  if (saved?.status === 'active' && isListed) return <BrowserView artifactTabId={tabId} />;
  return <p className="p-6 text-sm text-muted-foreground">{t('artifactPanel.unavailable')}</p>;
}
