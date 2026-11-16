'use client';

import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

/** Copies a value and shows a check for two seconds once the copy succeeded. */
export function CopyButton({ value, title }: { value: string; title: string }) {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  return (
    <Button
      onClick={() => copyToClipboard(value)}
      variant="outline"
      size="icon-sm"
      className="shrink-0"
      title={title}
      aria-label={title}
    >
      {isCopied ? <Check className="text-success" /> : <Copy />}
    </Button>
  );
}
