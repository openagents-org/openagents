'use client';

import { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { playNotificationSound } from '@/lib/notification-audio';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SectionHeader } from '@/components/settings/section-chrome';
import { SettingsCard, SettingsRow } from '@/components/settings/settings-card';
import { LOCALES, LOCALE_LABELS, isLocale, useI18n } from '@/lib/i18n';
import { desktopHost } from '@/lib/desktop-host';

/**
 * This-browser-only preferences. They live in localStorage under the same keys
 * the main workspace view reads on mount (workspace-context.tsx for the
 * notification sound, layout-context.tsx for split browser), so changes apply
 * immediately through a local preference event — no server round-trip involved.
 */
const SOUND_KEY = 'oa_notification_sound';
/** DM / mention sound — default ON, so only an explicit 'false' turns it off. */
const SIGNAL_SOUND_KEY = 'oa_signal_sound';
const SPLIT_KEY = 'x-split-browser';

export default function PreferencesSettingsPage() {
  const { t, locale, setLocale, isAutoDetected } = useI18n();
  const [sound, setSound] = useState(true);
  const [signalSound, setSignalSound] = useState(true);
  const [split, setSplit] = useState(false);

  useEffect(() => {
    try {
      setSound(localStorage.getItem(SOUND_KEY) !== 'false');
      setSignalSound(localStorage.getItem(SIGNAL_SOUND_KEY) !== 'false');
      setSplit(localStorage.getItem(SPLIT_KEY) === '1');
    } catch { /* storage unavailable */ }
  }, []);

  const toggleSound = (v: boolean) => {
    setSound(v);
    try { localStorage.setItem(SOUND_KEY, String(v)); window.dispatchEvent(new Event('workspace-sound-preferences'));  } catch {}
  };

  const toggleSignalSound = (v: boolean) => {
    setSignalSound(v);
    try { localStorage.setItem(SIGNAL_SOUND_KEY, String(v)); window.dispatchEvent(new Event('workspace-sound-preferences'));  } catch {}
  };

  const toggleSplit = (v: boolean) => {
    setSplit(v);
    try { localStorage.setItem(SPLIT_KEY, v ? '1' : '0'); } catch {}
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t('admin.preferencesTitle')}
        description={t(desktopHost() ? 'admin.preferencesDescriptionDesktop' : 'admin.preferencesDescription')}
      />

      {/* Applies immediately; nothing to save. */}
      <SettingsCard
        title={t('language.label')}
        description={isAutoDetected ? t('language.autoHint') : t('language.description')}
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={locale}
          onValueChange={(value) => { if (value && isLocale(value)) setLocale(value); }}
          aria-label={t('language.label')}
        >
          {LOCALES.map((option) => (
            <ToggleGroupItem key={option} value={option}>{LOCALE_LABELS[option]}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingsCard>

      <SettingsCard
        title={t('admin.notificationsTitle')}
        description={t('admin.notificationsHint')}
        action={(
          <Button variant="outline" size="sm" onClick={async () => {
            if (!await playNotificationSound(true)) toast.error(t('settings.soundBlocked'));
          }}>
            <Volume2 data-icon="inline-start" />
            {t('settings.testSound')}
          </Button>
        )}
      >
        <SettingsRow label={t('settings.notificationSound')} description={t('settings.notificationSoundHint')} htmlFor="pref-sound">
          <Switch id="pref-sound" checked={sound} onCheckedChange={toggleSound} />
        </SettingsRow>
        <SettingsRow label={t('slackSignals.soundLabel')} description={t('slackSignals.soundHint')} htmlFor="pref-signal-sound">
          <Switch id="pref-signal-sound" checked={signalSound} onCheckedChange={toggleSignalSound} />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title={t('settings.experimental')}>
        <SettingsRow label={t('settings.splitBrowser')} description={t('settings.splitBrowserHint')} htmlFor="pref-split-browser">
          <Switch id="pref-split-browser" checked={split} onCheckedChange={toggleSplit} />
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}
