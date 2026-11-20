'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

import { useT } from '@/lib/i18n';
import { applyBundleUpdate, onBundleUpdate, reportBundleStarted } from './host';

const TOAST_ID = 'desktop-bundle-update';
/** Well inside the launcher's probation window (45s), past the first route's lazy chunks. */
const STARTED_AFTER_MS = 3000;

/**
 * The page's side of the launcher's Workspace updates.
 *
 * It reports that the page started, which is what takes a freshly downloaded
 * bundle off probation — a few seconds after mounting rather than at once,
 * so a bundle whose first route crashes the app (which unmounts the whole
 * tree, this included) never reports and is rolled back. A crash an error
 * boundary catches is an ordinary bug, not a bundle that cannot run here.
 *
 * After that it offers any newer bundle the
 * launcher has ready as a refresh: the launcher cannot switch the files under
 * a page that is already running, and reloading without asking would throw
 * away whatever the user was in the middle of.
 *
 * Renders nothing; off the desktop every call here is a no-op.
 */
export function BundleUpdates(): null {
  const t = useT();

  useEffect(() => {
    const timer = setTimeout(reportBundleStarted, STARTED_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => onBundleUpdate((update) => {
    if (!update) {
      toast.dismiss(TOAST_ID);
      return;
    }
    toast(t('desktopBundle.ready'), {
      id: TOAST_ID,
      description: t('desktopBundle.readyHint'),
      duration: Infinity,
      action: { label: t('desktopBundle.refresh'), onClick: applyBundleUpdate },
    });
  }), [t]);

  return null;
}
