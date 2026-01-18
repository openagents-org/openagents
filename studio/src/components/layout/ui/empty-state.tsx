'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from './card';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  variant?: 'default' | 'minimal';
}

function EmptyState({
  className,
  icon,
  title,
  description,
  action,
  variant = 'default',
  ...props
}: EmptyStateProps) {
  if (variant === 'minimal') {
    return (
      <div
        data-slot="empty-state"
        className={cn('flex flex-col items-center justify-center py-12 text-center', className)}
        {...props}
      >
        {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
        {title && <h3 className="text-base font-semibold text-foreground mb-2">{title}</h3>}
        {description && <p className="text-sm text-muted-foreground mb-4 max-w-md">{description}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    );
  }

  return (
    <Card variant="default" className={cn('border-dashed', className)} {...props}>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
        {title && <h3 className="text-base font-semibold text-foreground mb-2">{title}</h3>}
        {description && <p className="text-sm text-muted-foreground mb-4 max-w-md">{description}</p>}
        {action && <div className="mt-2">{action}</div>}
      </CardContent>
    </Card>
  );
}

export { EmptyState };

