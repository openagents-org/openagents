'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type TourDismissScope = 'session' | 'forever';

/**
 * The ✕ on a guide banner. Asks before closing: hide it just for this visit
 * (it comes back the next time the workspace is opened) or turn it off for
 * good. Clicking outside or pressing Escape keeps the banner.
 */
export function TourDismissButton({
  onDismiss,
  className,
  size = 'icon-sm',
}: {
  onDismiss: (scope: TourDismissScope) => void;
  className?: string;
  size?: 'icon-xs' | 'icon-sm';
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const choose = (scope: TourDismissScope) => {
    setOpen(false);
    onDismiss(scope);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size={size} aria-label={t('featureTours.dismiss')} className={cn('text-muted-foreground', className)}>
          <X />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <PopoverHeader>
          <PopoverTitle>{t('featureTours.dismissTitle')}</PopoverTitle>
          <PopoverDescription className="text-xs">{t('featureTours.dismissDescription')}</PopoverDescription>
        </PopoverHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => choose('session')}>
            {t('featureTours.dismissSession')}
          </Button>
          <Button size="sm" onClick={() => choose('forever')}>
            {t('featureTours.dismissForever')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
