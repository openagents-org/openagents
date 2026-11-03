'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useT } from '@/lib/i18n';
export function useCopyToClipboard({
  timeout = 2000,
  onCopy,
}: {
  timeout?: number;
  onCopy?: () => void;
} = {}) {
  const t = useT();
  const [isCopied, setIsCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attempt = React.useRef(0);
  React.useEffect(() => () => {
    ++attempt.current;
    clearTimeout(timer.current);
  }, []);

  const copyToClipboard = async (value: string): Promise<boolean> => {
    const current = ++attempt.current;
    clearTimeout(timer.current);
    setIsCopied(false);
    if (!value) return false;
    try {
      await copyTextToClipboard(value);
    } catch {
      if (current === attempt.current) toast.error(t('chat.copyFailed'));
      return false;
    }
    if (current === attempt.current) {
      setIsCopied(true);
      timer.current = setTimeout(() => setIsCopied(false), timeout);
      onCopy?.();
    }
    return true;
  };

  return { isCopied, copyToClipboard };
}
