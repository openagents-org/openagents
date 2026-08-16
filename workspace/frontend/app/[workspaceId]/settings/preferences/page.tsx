'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SectionHeader } from '@/components/settings/section-chrome';
import { useT } from '@/lib/i18n';

/**
 * This-browser-only preferences. They live in localStorage under the same keys
 * the main workspace view reads on mount (workspace-context.tsx for the
 * notification sound, layout-context.tsx for split browser), so changes apply
 * the next time the workspace view mounts — no server round-trip involved.
 */
const SOUND_KEY = 'oa_notification_sound';
const SPLIT_KEY = 'x-split-browser';

export default function PreferencesSettingsPage() {
  const t = useT();
  const [sound, setSound] = useState(false);
  const [split, setSplit] = useState(false);

  useEffect(() => {
    try {
      setSound(localStorage.getItem(SOUND_KEY) === 'true');
      setSplit(localStorage.getItem(SPLIT_KEY) === '1');
    } catch { /* storage unavailable */ }
  }, []);

  const toggleSound = (v: boolean) => {
    setSound(v);
    try { localStorage.setItem(SOUND_KEY, String(v)); } catch {}
  };

  const toggleSplit = (v: boolean) => {
    setSplit(v);
    try { localStorage.setItem(SPLIT_KEY, v ? '1' : '0'); } catch {}
  };

  return (
    <div className="space-y-8">
      <SectionHeader
        title={t('admin.preferencesTitle')}
        description={t('admin.preferencesDescription')}
      />

      <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
        <div className="space-y-0.5">
          <Label>{t('settings.notificationSound')}</Label>
          <p className="text-xs text-muted-foreground">{t('settings.notificationSoundHint')}</p>
        </div>
        <Switch checked={sound} onCheckedChange={toggleSound} size="sm" />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Label>{t('settings.splitBrowser')}</Label>
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {t('settings.experimental')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.splitBrowserHint')}</p>
        </div>
        <Switch checked={split} onCheckedChange={toggleSplit} size="sm" />
      </div>
    </div>
  );
}
