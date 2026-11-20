'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { destructiveIconClass } from '@/lib/destructive-icon';
import { cn } from '@/lib/utils';

/**
 * An icon-only row action: the label is both the button's accessible name
 * and its tooltip, so the icon never stands alone. `destructive` keeps the
 * ghost look and turns red only on hover or focus.
 */
export function IconAction({
  label,
  size = 'icon-sm',
  variant = 'ghost',
  destructive = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'aria-label' | 'title'> & { label: string; destructive?: boolean }) {
  return (
    <WithTooltip label={label}>
      <Button
        size={size}
        variant={destructive ? 'ghost' : variant}
        aria-label={label}
        className={cn(destructive && destructiveIconClass, className)}
        {...props}
      >
        {children}
      </Button>
    </WithTooltip>
  );
}
