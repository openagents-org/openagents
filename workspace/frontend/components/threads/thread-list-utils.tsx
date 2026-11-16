import { addressName, dmCounterpart } from '@/lib/dm';
import type { MessageKey } from '@/lib/i18n';

// ── DM helpers ──

/** Title of a DM conversation as the human viewer sees it: just the
 * counterpart (agent or other person) when the viewer is in the pair; pairs
 * the viewer only observes (agent↔agent) keep both names. */
export function dmDisplayTitle(pair: string[], me: string): string {
  const counterpart = dmCounterpart(pair, me);
  if (counterpart) return addressName(counterpart);
  return pair.map(addressName).join(' ↔ ');
}

/** Dedup key: one row per counterpart for the viewer's own DMs (the legacy
 * shared `human:user` conversation and the per-person one with the same
 * counterpart collapse into one row — most recent wins). Pairs the viewer
 * only observes stay unique per pair. */
export function dmDedupKey(pair: string[], me: string): string {
  const counterpart = dmCounterpart(pair, me);
  return counterpart ? `counterpart:${counterpart}` : `pair:${pair.join(',')}`;
}

export const dmRowId = (agents: readonly string[]) => `dm:${agents[0]},${agents[1]}`;

// ── Filter tabs ──

export type FilterTab = 'all' | 'channels' | 'starred' | 'archived' | 'dms';

// Ordered the way people grow into the product: everything, then 1:1 DMs,
// then channels, then the bookkeeping views.
export const TABS: { id: FilterTab; labelKey: MessageKey }[] = [
  { id: 'all', labelKey: 'threads.tabAll' },
  { id: 'dms', labelKey: 'threads.tabDms' },
  { id: 'channels', labelKey: 'threads.tabChannels' },
  { id: 'starred', labelKey: 'threads.tabStarred' },
  { id: 'archived', labelKey: 'threads.tabArchived' },
];

export type SortOrder = 'recent' | 'oldest' | 'title';

export interface SearchHit {
  channelName: string;
  snippet: string;
  messageId: string;
}

export function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-warning/20 px-0.5 text-foreground">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Row surface, shared by thread and DM rows ──

export const ROW_BASE =
  'group relative flex shrink-0 cursor-pointer items-start gap-2 border-b border-border/40 px-2 py-2.5 transition-colors md:px-3 ' +
  'focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none';
// The open row gets a full outline; its own divider goes transparent so the
// two can't collide.
export const ROW_SELECTED = 'rounded-md border-transparent bg-accent ring-1 ring-inset ring-foreground/20';
export const ROW_IDLE = 'hover:bg-muted/50 has-data-[state=open]:bg-muted/50';

/** Unread-count pills share the nav rail's unread accent (DmUnreadBadge): neutral ink, "something new". */
export const UNREAD_ACCENT = 'bg-primary text-primary-foreground';
/** The "@" pill asks for the viewer's attention, so it takes the nav rail's red count colour. */
export const MENTION_ACCENT = 'bg-destructive text-white';
