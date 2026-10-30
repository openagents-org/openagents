import type { TranslateFn } from '@/lib/i18n';

/** The desktop app's installers, as the pairing page and the add form offer them. */
export function desktopDownloads(t: TranslateFn): { os: string; href: string }[] {
  return [
    { os: t('connect.nodeMacSilicon'), href: 'https://openagents.org/api/download/launcher/mac' },
    { os: t('connect.nodeMacIntel'), href: 'https://openagents.org/api/download/launcher/mac-intel' },
    { os: 'Windows', href: 'https://openagents.org/api/download/launcher/windows' },
  ];
}
