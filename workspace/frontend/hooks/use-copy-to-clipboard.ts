'use client';

import * as React from 'react';
import { copyTextToClipboard as copyText } from '@/lib/clipboard';

export function useCopyToClipboard({
  timeout = 2000,
  onCopy,
}: {
  timeout?: number;
  onCopy?: () => void;
} = {}) {
  const [isCopied, setIsCopied] = React.useState(false);

  const copyToClipboard = (value: string) => {
    if (!value) return;

    copyText(value).then(() => {
      setIsCopied(true);

      if (onCopy) {
        onCopy();
      }

      setTimeout(() => {
        setIsCopied(false);
      }, timeout);
    }, console.error);
  };

  return { isCopied, copyToClipboard };
}
