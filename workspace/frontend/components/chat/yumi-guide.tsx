'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
export function YumiGuide() {
  const t = useT();
  // Render nothing until mounted — the collapsed state lives in localStorage,
  // which the server doesn't know, and rendering a guess would flash/mismatch.
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      // storage unavailable (private mode) — default to expanded
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
          <Alert role="note" className="flex items-start gap-3">
            <img src="/yumi-avatar.png" alt="Yumi" className="mt-0.5 size-8 shrink-0 rounded-full object-cover" draggable={false} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <AlertTitle>{t('yumiGuide.title')}</AlertTitle>
              <AlertDescription className="text-xs">
                <ul className="flex list-disc flex-col gap-0.5 pl-4">
                  <li>{t('yumiGuide.itemConnect')}</li>
                  <li>{t('yumiGuide.itemAgents')}</li>
                  <li>{t('yumiGuide.itemManage')}</li>
                  <li>{t('yumiGuide.itemDebug')}</li>
                </ul>
                <p className="mt-1.5 italic">{t('yumiGuide.hint')}</p>
              </AlertDescription>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground">
                {t('yumiGuide.minimize')}
                <ChevronUp data-icon="inline-end" />
              </Button>
            </CollapsibleTrigger>
          </Alert>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
