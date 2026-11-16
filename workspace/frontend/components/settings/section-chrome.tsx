'use client';

import { Lock } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useT } from '@/lib/i18n';
import { useAdminSettings } from './admin-context';
import { roleLabel } from '@/lib/roles';

/** Title + description header shared by every settings dashboard section. */
export function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-heading text-xl font-semibold">{title}</h2>
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
    <Alert>
      <Lock className="text-warning" />
      <AlertDescription>
        {t('admin.readOnlyBanner', {
          role: roleLabel(t, me.effectiveRole ?? me.role) || '?',
        })}
      </AlertDescription>
    </Alert>
  );
}
