'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useT } from '@/lib/i18n';

/** An icon button inside an input group, named and explained by its tooltip. */
export function InputGroupAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <WithTooltip label={label}><InputGroupButton size="icon-xs" aria-label={label} onClick={onClick}>
          {children}
        </InputGroupButton></WithTooltip>
  );
}

/**
 * A read-only value with a copy button inside the field. `display` replaces
 * what is shown (e.g. a masked secret) while the copy still takes `value`;
 * `actions` go before the copy button. Settings rows give it a fixed width
 * beside the label; pass `className` to size it otherwise.
 */
export function CopyInput({
  id,
  value,
  display,
  actions,
  onCopy,
  className = '@md/field-group:w-80',
}: {
  id?: string;
  value: string;
  display?: string;
  actions?: React.ReactNode;
  onCopy?: () => void;
  className?: string;
}) {
  const t = useT();
  const { isCopied, copyToClipboard } = useCopyToClipboard({ onCopy });
  return (
    <InputGroup className={className}>
      <InputGroupInput id={id} value={display ?? value} readOnly className="font-mono text-xs" />
      <InputGroupAddon align="inline-end">
        {actions}
        <InputGroupAction label={isCopied ? t('common.copied') : t('common.copy')} onClick={() => copyToClipboard(value)}>
          {isCopied ? <Check /> : <Copy />}
        </InputGroupAction>
      </InputGroupAddon>
    </InputGroup>
  );
}
