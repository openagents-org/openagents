'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

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

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  if (!mounted) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-expanded={false}
        className="flex w-full items-center gap-2 border-b border-border/50 bg-primary/5 px-4 py-1.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-primary/10 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 lg:px-8"
      >
        <img src="/yumi-avatar.png" alt="" className="size-4 rounded-full object-cover" draggable={false} />
        <span className="truncate">{t('yumiGuide.collapsedHint')}</span>
        <ChevronDown className="ml-auto size-3.5 shrink-0" />
      </button>
    );
  }

  return (
    <div className="border-b border-border/50 bg-primary/5">
      <div className="mx-auto w-full max-w-3xl xl:max-w-4xl 2xl:max-w-6xl px-4 lg:px-8 py-3">
        <div className="flex items-start gap-3">
          <img
            src="/yumi-avatar.png"
            alt="Yumi"
            className="size-8 shrink-0 rounded-full object-cover mt-0.5"
            draggable={false}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold leading-tight">{t('yumiGuide.title')}</div>
            <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground list-disc pl-4">
              <li>{t('yumiGuide.itemConnect')}</li>
              <li>{t('yumiGuide.itemAgents')}</li>
              <li>{t('yumiGuide.itemManage')}</li>
              <li>{t('yumiGuide.itemDebug')}</li>
            </ul>
            <div className="mt-1.5 text-xs text-muted-foreground italic">
              {t('yumiGuide.hint')}
            </div>
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={toggle}
            aria-expanded
            className="text-muted-foreground"
            title={t('yumiGuide.minimize')}
          >
            {t('yumiGuide.minimize')}
            <ChevronUp data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </div>
  );
}
