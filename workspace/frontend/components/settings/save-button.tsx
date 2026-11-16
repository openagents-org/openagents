'use client';

import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';

/**
 * The Save action in a settings card footer. Solid only while there is
 * something to save, a spinner while saving, and a brief "Saved" afterwards so
 * the click is confirmed rather than the button just greying out again.
 */
export function SaveButton({
  dirty,
  saving,
  saved = false,
  disabled = false,
  onClick,
}: {
  dirty: boolean;
  saving: boolean;
  saved?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <Button
      size="sm"
      variant={dirty || saving ? 'default' : 'outline'}
      onClick={onClick}
      disabled={saving || !dirty || disabled}
    >
      {saving ? (
        <><Spinner data-icon="inline-start" />{t('common.saving')}</>
      ) : saved && !dirty ? (
        <><Check data-icon="inline-start" />{t('common.saved')}</>
      ) : (
        t('common.save')
      )}
    </Button>
  );
}
