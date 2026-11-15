'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { playNotificationSound } from '@/lib/notification-audio';
import { Label } from '@/components/ui/label';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { SectionHeader } from '@/components/settings/section-chrome';
import { useT } from '@/lib/i18n';
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
  const t = useT();
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
    <div className="flex flex-col gap-8">
      <SectionHeader
        title={t('admin.preferencesTitle')}
        description={t(desktopHost() ? 'admin.preferencesDescriptionDesktop' : 'admin.preferencesDescription')}
      />

      <Button variant="outline" onClick={async () => {
        if (!await playNotificationSound(true)) toast.error(t('settings.soundBlocked'));
      }}>{t('settings.testSound')}</Button>
      <FieldLabel htmlFor="pref-sound">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>{t('settings.notificationSound')}</FieldTitle>
            <FieldDescription>{t('settings.notificationSoundHint')}</FieldDescription>
          </FieldContent>
          <Switch id="pref-sound" checked={sound} onCheckedChange={toggleSound} size="sm" />
        </Field>
      </FieldLabel>

      <FieldLabel htmlFor="pref-signal-sound">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>{t('slackSignals.soundLabel')}</FieldTitle>
            <FieldDescription>{t('slackSignals.soundHint')}</FieldDescription>
          </FieldContent>
          <Switch id="pref-signal-sound" checked={signalSound} onCheckedChange={toggleSignalSound} size="sm" />
        </Field>
      </FieldLabel>

      <FieldLabel htmlFor="pref-split-browser">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>{t('settings.splitBrowser')}
              <Badge variant="warning">{t('settings.experimental')}</Badge></FieldTitle>
            <FieldDescription>{t('settings.splitBrowserHint')}</FieldDescription>
          </FieldContent>
          <Switch id="pref-split-browser" checked={split} onCheckedChange={toggleSplit} size="sm" />
        </Field>
      </FieldLabel>
    </div>
  );
}
