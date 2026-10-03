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
import { Info, Loader2 } from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import type { AccessExplanation, ResourceKind as GrantResourceKind } from '@/lib/types';
import { useT } from '@/lib/i18n';
import type { TranslateFn } from '@/lib/i18n';
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

export function AccessExplainer({ resourceKind, resourceId, className }: AccessExplainerProps) {
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

  return (
    <button
      type="button"
      onClick={explain}
      disabled={state.status === 'loading' || state.status === 'done'}
      title={state.status === 'done' ? state.explanation.text || label : t('accessExplain.why')}
      aria-live="polite"
      className={cn(
        'inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground/80 transition-colors',
        state.status === 'idle' || state.status === 'error' ? 'hover:text-foreground' : 'cursor-default',
        className,
      )}
    >
      {state.status === 'loading' ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Info className="size-3 shrink-0" />}
      <span className="truncate">{label}</span>
    </button>
  );
}
