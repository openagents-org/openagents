'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { copyTextToClipboard } from '../utils/clipboard';

export function useCopyToClipboard({
  timeout = 2000,
  onCopy,
}: {
  timeout?: number;
  onCopy?: () => void;
} = {}) {
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
      if (current === attempt.current) toast.error('Failed to copy text to clipboard');
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
