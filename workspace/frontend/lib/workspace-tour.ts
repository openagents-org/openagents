/**
 * The workspace's guided tour: a few spotlight steps over the everyday
 * controls (Manage Agents, threads, @mentions, search, help). It runs once on
 * its own and can be started again from the user menu.
 */

const START_EVENT = 'oa:workspace-tour';
const SEEN_KEY = 'oa:workspaceTourSeen';

/** Open the tour from anywhere (the user menu), wherever it is mounted. */
export function startWorkspaceTour(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(START_EVENT));
}

export function onStartWorkspaceTour(listener: () => void): () => void {
  window.addEventListener(START_EVENT, listener);
  return () => window.removeEventListener(START_EVENT, listener);
}

/** Whether the tour already ran (finished or skipped) in this browser. */
export function workspaceTourSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
}

export function markWorkspaceTourSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: it may show again */ }
}

export interface Box { top: number; left: number; width: number; height: number }

/**
 * Where the step's card goes: beside the highlighted control when it fits
 * (right, then left), otherwise above or below it, always inside the window.
 * A control wider than the card (the message box) gets it above or below
 * first, so the card does not land over the thread list beside it.
 */
export function placeTourCard(
  hole: Box,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 12,
  margin = 16,
): { top: number; left: number } {
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
  const midY = clamp(hole.top + hole.height / 2 - card.height / 2, margin, viewport.height - card.height - margin);
  const midX = clamp(hole.left + hole.width / 2 - card.width / 2, margin, viewport.width - card.width - margin);
  const right = { top: midY, left: hole.left + hole.width + gap };
  const left = { top: midY, left: hole.left - gap - card.width };
  const above = { top: hole.top - gap - card.height, left: midX };
  const below = { top: hole.top + hole.height + gap, left: midX };
  const fitsRight = right.left + card.width <= viewport.width - margin;
  const fitsLeft = left.left >= margin;
  const fitsAbove = above.top >= margin;
  const fitsBelow = below.top + card.height <= viewport.height - margin;
  const order: [boolean, { top: number; left: number }][] = hole.width > card.width
    ? [[fitsAbove, above], [fitsBelow, below], [fitsRight, right], [fitsLeft, left]]
    : [[fitsRight, right], [fitsLeft, left], [fitsAbove, above], [fitsBelow, below]];
  const fit = order.find(([fits]) => fits);
  return fit ? fit[1] : { top: midY, left: midX };
}
