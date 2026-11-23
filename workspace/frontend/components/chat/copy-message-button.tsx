'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

/** The "Copy" action under a message: copies its text, says "Copied" for 2s. */
export function CopyMessageButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('chat.copyFailed'));
    }
  };

  return (
    <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={handleCopy} aria-label={t('chat.copyMessage')} data-copy-message="">
      {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {copied ? t('common.copied') : t('common.copy')}
    </Button>
  );
}
