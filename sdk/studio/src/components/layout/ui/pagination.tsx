'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { MoreHorizontal } from 'lucide-react';

const Pagination = ({ className, ...props }: React.ComponentProps<'nav'>) => (
  <nav
    data-slot="pagination"
    role="navigation"
    aria-label="pagination"
    className={cn('mx-auto flex w-full justify-center', className)}
    {...props}
  />
);

function PaginationContent({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="pagination-content" className={cn('flex flex-row items-center gap-1', className)} {...props} />;
}

function PaginationItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="pagination-item" className={cn('', className)} {...props} />;
}

const PaginationEllipsis = ({ className, ...props }: React.ComponentProps<'span'>) => (
  <span
    data-slot="pagination-ellipsis"
    aria-hidden
    className={cn('flex h-9 w-9 items-center justify-center', className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More pages</span>
  </span>
);

export { Pagination, PaginationContent, PaginationEllipsis, PaginationItem };
