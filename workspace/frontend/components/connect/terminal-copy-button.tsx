'use client';

import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useT, type MessageKey } from '@/lib/i18n';

/** Copy control for the dark command panels in device and agent setup. */
export function TerminalCopyButton({ text, label, ariaLabel, disabled = false }: {
  text: string;
  /** What the button says before it is pressed. */
  label: MessageKey;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const t = useT();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  return (
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => copyToClipboard(text)} aria-label={ariaLabel}
      className="shrink-0 border-white/15 bg-transparent text-white/80 hover:bg-white/10 hover:text-white">
      {isCopied ? <Check data-icon="inline-start" className="text-emerald-400" /> : <Copy data-icon="inline-start" />}
      {/* Announced, so a screen reader hears that the copy happened. */}
      <span aria-live="polite">{t(isCopied ? 'onboarding.codeCopied' : label)}</span>
    </Button>
  );
}
