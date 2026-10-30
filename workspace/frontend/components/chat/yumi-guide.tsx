'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useT } from '@/lib/i18n';

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
        onClick={toggle}
        className="w-full flex items-center gap-2 px-4 lg:px-8 py-1.5 text-[12px] text-muted-foreground hover:text-foreground bg-primary/[0.03] hover:bg-primary/[0.06] border-b border-border/50 transition-colors"
      >
        <img src="/yumi-avatar.png" alt="" className="size-4 rounded-full object-cover" draggable={false} />
        <span className="truncate">{t('yumiGuide.collapsedHint')}</span>
        <ChevronDown className="size-3.5 ml-auto shrink-0" />
      </button>
    );
  }

  return (
    <div className="border-b border-border/50 bg-primary/[0.03]">
      <div className="mx-auto w-full max-w-3xl xl:max-w-4xl 2xl:max-w-6xl px-4 lg:px-8 py-3">
        <div className="flex items-start gap-3">
          <img
            src="/yumi-avatar.png"
            alt="Yumi"
            className="size-8 shrink-0 rounded-full object-cover mt-0.5"
            draggable={false}
          />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold leading-tight">{t('yumiGuide.title')}</div>
            <ul className="mt-1.5 space-y-0.5 text-[12px] text-muted-foreground list-disc pl-4">
              <li>{t('yumiGuide.itemConnect')}</li>
              <li>{t('yumiGuide.itemAgents')}</li>
              <li>{t('yumiGuide.itemManage')}</li>
              <li>{t('yumiGuide.itemDebug')}</li>
            </ul>
            <div className="mt-1.5 text-[12px] text-muted-foreground/80 italic">
              {t('yumiGuide.hint')}
            </div>
          </div>
          <button
            onClick={toggle}
            className="shrink-0 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-1 rounded hover:bg-accent transition-colors"
            title={t('yumiGuide.minimize')}
          >
            {t('yumiGuide.minimize')}
            <ChevronUp className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
