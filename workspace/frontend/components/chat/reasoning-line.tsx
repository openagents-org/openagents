'use client';

import { useState } from 'react';
import { CircleCheck, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';
import { useT } from '@/lib/i18n';

/**
 * An agent's reasoning as one Trace line (shadcn AI Elements "Reasoning"):
 * "Thinking" with a spinner while it streams, then "Thought". The text sits in
 * the collapsible body — open while running, closed once done, unless the
 * reader toggled it.
 */
export function ReasoningLine({ text, running, className }: { text: string; running: boolean; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState<boolean>();

  const line = (
    <TraceLine status={running ? 'running' : undefined} className={className}>
      <TraceIcon>
        {running ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <CircleCheck />}
      </TraceIcon>
      <TraceTitle>{running ? t('chat.thinking') : t('chat.thought')}</TraceTitle>
    </TraceLine>
  );

  if (text.length === 0) return line;

  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className={cn('whitespace-pre-wrap', className)}>
        {text}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
