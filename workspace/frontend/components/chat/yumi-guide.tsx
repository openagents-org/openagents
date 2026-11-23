'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';
import { YumiAgentLocation } from './yumi-agent-location';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

// Remembered per browser (not per workspace): once minimized, the guide stays
// a slim strip everywhere until the user expands it again.
const STORAGE_KEY = 'oa_yumi_guide_collapsed';

/**
 * Guidance banner pinned to the top of threads that include the built-in Yumi
 * assistant. Explains what Yumi can do; collapsible to a one-line strip the
 * user can reopen anytime (so the guidance stays reviewable after dismissal).
 */
export function YumiGuide({ showSetup, canStartThread }: { showSetup: boolean; canStartThread: boolean }) {
  const t = useT();
  const { openNewThread } = useLayout();
  // Render nothing until mounted — the collapsed state lives in localStorage,
  // which the server doesn't know, and rendering a guess would flash/mismatch.
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) !== '0');
    } catch {
      // storage unavailable (private mode) — keep the guide collapsed
    }
    setMounted(true);
  }, []);

  const setOpen = (open: boolean) => {
    setCollapsed(!open);
    try {
      window.localStorage.setItem(STORAGE_KEY, open ? '0' : '1');
    } catch {}
  };

  if (!mounted) return null;

  return (
    <Collapsible open={!collapsed} onOpenChange={setOpen} className="border-b">
      {collapsed && (
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-start rounded-none px-4 text-xs font-normal text-muted-foreground lg:px-8">
            <img src="/yumi-avatar.png" alt="" className="size-4 rounded-full object-cover" draggable={false} />
            <span className="truncate">{t('yumiGuide.collapsedHint')}</span>
            <ChevronDown className="ml-auto" />
          </Button>
        </CollapsibleTrigger>
      )}
      <CollapsibleContent>
        <div className="mx-auto w-full max-w-3xl px-4 py-3 lg:px-8 xl:max-w-4xl 2xl:max-w-6xl">
          <div className="flex items-center gap-2">
            <img src="/yumi-avatar.png" alt="" className="size-5 rounded-full object-cover" draggable={false} />
            <p className="min-w-0 flex-1 text-sm font-medium">{t('yumiGuide.title')}</p>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground">
                {t('yumiGuide.minimize')}
                <ChevronUp data-icon="inline-end" />
              </Button>
            </CollapsibleTrigger>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('yumiGuide.hint')}</p>
          {showSetup && <YumiAgentLocation />}
          {canStartThread && (
            <Button variant="outline" size="sm" className="mt-2" onClick={openNewThread}>
              {t('chat.newThread')}
            </Button>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
