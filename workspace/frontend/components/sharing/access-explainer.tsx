'use client';

/**
 * Permission model v1.1 — "Why can I see this?"
 *
 * A muted line with an info icon. Nothing is fetched until the reader asks:
 * the first click calls GET /access/explain for the caller and swaps the
 * question for the answer ("You own it." / "Shared with your group X." …).
 * Self-contained so it can be dropped into any info surface — file header,
 * knowledge entry view, agent profile, thread info.
 */

import { useState } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { workspaceApi } from '@/lib/api';
import type { AccessExplanation, ResourceKind as GrantResourceKind } from '@/lib/types';
import { useT } from '@/lib/i18n';
import type { TranslateFn } from '@/lib/i18n';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface AccessExplainerProps {
  resourceKind: GrantResourceKind;
  resourceId: string;
  className?: string;
}

/** Localised wording for a reason code; falls back to the backend's text. */
export function explanationText(t: TranslateFn, explanation: AccessExplanation): string {
  const { reason, text } = explanation;
  if (reason.startsWith('group:')) return t('accessExplain.group', { group: reason.slice('group:'.length) });
  switch (reason) {
    case 'owner': return t('accessExplain.owner');
    case 'public': return t('accessExplain.public');
    case 'participant': return t('accessExplain.participant');
    case 'grant': return t('accessExplain.grant');
    case 'inherited_from_owner': return t('accessExplain.inheritedFromOwner');
    case 'inherited_from_channel': return t('accessExplain.inheritedFromChannel');
    case 'admin_metadata': return t('accessExplain.adminMetadata');
    case 'machine': return t('accessExplain.machine');
    case 'denied': return t('accessExplain.denied');
    default: return text || reason;
  }
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; explanation: AccessExplanation }
  | { status: 'error' };

export function AccessExplainer({ resourceKind, resourceId, className, compact = false }: AccessExplainerProps & { compact?: boolean }) {
  const t = useT();
  const [state, setState] = useState<State>({ status: 'idle' });

  const explain = async () => {
    if (state.status === 'loading' || state.status === 'done') return;
    setState({ status: 'loading' });
    try {
      const explanation = await workspaceApi.explainAccess(resourceKind, resourceId);
      setState({ status: 'done', explanation });
    } catch {
      setState({ status: 'error' });
    }
  };

  const label =
    state.status === 'loading' ? t('accessExplain.loading')
    : state.status === 'done' ? explanationText(t, state.explanation)
    : state.status === 'error' ? t('accessExplain.failed')
    : t('accessExplain.why');

  if (compact) {
    // Icon-only form for tight places such as the thread header: the answer
    // is fetched on hover/focus and shown in a tooltip.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            onMouseEnter={explain}
            onFocus={explain}
            onClick={explain}
            aria-label={label}
            className={cn('text-muted-foreground', className)}
          >
            {state.status === 'loading' ? <Spinner /> : <Info />}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{label}</TooltipContent>
      </Tooltip>
    );
  }

  // Stays enabled once answered (clicks are then no-ops) so the tooltip can
  // still show an answer the row truncates.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          onClick={explain}
          disabled={state.status === 'loading'}
          aria-live="polite"
          className={cn('min-w-0 shrink justify-start font-normal text-muted-foreground', state.status === 'done' && 'cursor-default hover:bg-transparent', className)}
        >
          {state.status === 'loading' ? <Spinner data-icon="inline-start" /> : <Info data-icon="inline-start" />}
          <span className="truncate">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{state.status === 'done' ? state.explanation.text || label : t('accessExplain.why')}</TooltipContent>
    </Tooltip>
  );
}
