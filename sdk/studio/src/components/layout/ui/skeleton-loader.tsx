'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';
import { Card, CardContent, CardHeader } from './card';

export interface SkeletonLoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'table' | 'card' | 'list' | 'form';
  rows?: number;
  showHeader?: boolean;
}

function SkeletonLoader({
  className,
  variant = 'card',
  rows = 3,
  showHeader = true,
  ...props
}: SkeletonLoaderProps) {
  if (variant === 'table') {
    return (
      <div className={cn('w-full', className)} {...props}>
        {showHeader && (
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-8 w-32" />
          </div>
        )}
        <div className="rounded-md border">
          <div className="border-b p-4">
            <div className="flex gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-4 flex-1" />
              ))}
            </div>
          </div>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <div key={rowIndex} className="border-b p-4 last:border-b-0">
              <div className="flex gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 flex-1" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className={cn('w-full space-y-3', className)} {...props}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4 border rounded-lg">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'form') {
    return (
      <div className={cn('w-full space-y-4', className)} {...props}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    );
  }

  // Default: card variant
  return (
    <Card className={cn('', className)} {...props}>
      {showHeader && (
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
      )}
      <CardContent className="space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

export { SkeletonLoader };

