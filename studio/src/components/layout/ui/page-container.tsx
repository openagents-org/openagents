'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Standardized padding for page content
   * @default 'default' - px-6 py-4
   */
  padding?: 'none' | 'sm' | 'default' | 'lg';
}

/**
 * Standardized page container component
 * Provides consistent padding and spacing across all pages
 */
function PageContainer({
  className,
  padding = 'default',
  children,
  ...props
}: PageContainerProps) {
  const paddingClasses = {
    none: '',
    sm: 'px-4 py-3',
    default: 'px-6 py-4',
    lg: 'px-8 py-6',
  };

  return (
    <div
      data-slot="page-container"
      className={cn('w-full h-full', paddingClasses[padding], className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { PageContainer };

