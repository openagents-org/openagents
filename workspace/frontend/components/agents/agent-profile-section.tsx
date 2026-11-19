'use client';

import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

/**
 * One section of the agent profile. Every section shares this heading, and the
 * panel draws the rule between them, so no section styles its own frame.
 */
export function ProfileSection({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 py-5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A profile section that starts folded, for details few people need. */
export function ProfileCollapsibleSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Collapsible asChild>
      <section className="group/section py-5">
        <h3 className="text-sm font-medium">
          <CollapsibleTrigger className="flex min-h-6 w-full items-center justify-between gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            {title}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/section:rotate-180" />
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent className="pt-3">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}
