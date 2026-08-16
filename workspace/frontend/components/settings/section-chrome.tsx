'use client';

import { Lock } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useAdminSettings } from './admin-context';

/** Title + description header shared by every settings dashboard section. */
export function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1 border-b pb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

/** Shown when the caller's role can't change the section's settings. The
 * backend enforces permissions regardless — this just explains the disabled
 * controls instead of letting every mutation fail with a toast. */
export function ReadOnlyBanner() {
  const t = useT();
  const { me } = useAdminSettings();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
      <Lock className="size-3.5 shrink-0" />
      {t('admin.readOnlyBanner', { role: me.effectiveRole ?? me.role ?? '?' })}
    </div>
  );
}
