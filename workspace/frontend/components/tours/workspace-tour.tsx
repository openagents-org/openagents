'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { useModKey } from '@/hooks/use-mod-key';
import { useT, type MessageKey } from '@/lib/i18n';
import {
  markWorkspaceTourSeen, onStartWorkspaceTour, placeTourCard, workspaceTourSeen, type Box,
} from '@/lib/workspace-tour';

/** Each step points at the control carrying `data-tour="<anchor>"`. */
const STEPS: { anchor: string; title: MessageKey; body: MessageKey }[] = [
  { anchor: 'manage-agents', title: 'workspaceTour.agentsTitle', body: 'workspaceTour.agentsBody' },
  { anchor: 'view-threads', title: 'workspaceTour.threadsTitle', body: 'workspaceTour.threadsBody' },
  { anchor: 'composer', title: 'workspaceTour.mentionTitle', body: 'workspaceTour.mentionBody' },
  { anchor: 'search', title: 'workspaceTour.searchTitle', body: 'workspaceTour.searchBody' },
  { anchor: 'user-menu', title: 'workspaceTour.helpTitle', body: 'workspaceTour.helpBody' },
];

/** Room around the highlighted control, so its ring does not touch it. */
const PAD = 4;
/** How long the workspace has to settle before the tour starts on its own. */
const AUTO_START_MS = 1500;

/** The first visible element for an anchor: hidden copies (a closed panel) have no box. */
function anchorBox(anchor: string): Box | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
    }
  }
  return null;
}

/**
 * The workspace's guided tour: the screen dims around one control at a time
 * with a short card beside it. It starts once on its own — when the workspace
 * has an agent and no first-run setup is showing — and again whenever the
 * user menu asks. A step whose control is not on screen (no thread open, so no
 * message box) is left out rather than pointing at nothing.
 */
export function WorkspaceTour({ autoStart }: { autoStart: boolean }) {
  const t = useT();
  const mod = useModKey();
  const [steps, setSteps] = useState<typeof STEPS | null>(null);
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Box | null>(null);
  const [card, setCard] = useState({ width: 320, height: 160 });
  const cardRef = useRef<HTMLDivElement>(null);

  const open = useCallback(() => {
    const present = STEPS.filter((step) => anchorBox(step.anchor));
    if (present.length === 0) return;
    setIndex(0);
    setSteps(present);
  }, []);

  const close = useCallback(() => {
    markWorkspaceTourSeen();
    setSteps(null);
    setHole(null);
  }, []);

  useEffect(() => onStartWorkspaceTour(open), [open]);

  // Once, by itself. Not under automation, where it would sit over the page.
  useEffect(() => {
    if (!autoStart || workspaceTourSeen() || (typeof navigator !== 'undefined' && navigator.webdriver)) return;
    const timer = setTimeout(() => { if (!workspaceTourSeen()) open(); }, AUTO_START_MS);
    return () => clearTimeout(timer);
  }, [autoStart, open]);

  const step = steps?.[index];

  // Follow the control while the step shows: the layout can still be moving
  // (a panel sliding in, the window resizing).
  useEffect(() => {
    if (!step) return;
    let frame = 0;
    const track = () => {
      const box = anchorBox(step.anchor);
      setHole((prev) => (box && prev && box.top === prev.top && box.left === prev.left
        && box.width === prev.width && box.height === prev.height ? prev : box));
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [step]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const sync = () => setCard((prev) => (prev.width === el.offsetWidth && prev.height === el.offsetHeight
      ? prev : { width: el.offsetWidth, height: el.offsetHeight }));
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
    // The card only exists once the control has a box.
  }, [step, hole !== null]);

  const last = !!steps && index === steps.length - 1;
  const next = useCallback(() => { if (last) close(); else setIndex((i) => i + 1); }, [last, close]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, close, next, back]);

  if (!steps || !step || !hole) return null;

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const position = placeTourCard(hole, card, viewport);
  const shade = 'absolute bg-black/50';

  return createPortal(
    <div className="fixed inset-0 z-100 animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-labelledby="workspace-tour-title">
      {/* Four panels around the control: they take every stray click while
          the control itself stays usable. */}
      <div className={`${shade} inset-x-0 top-0`} style={{ height: hole.top }} />
      <div className={`${shade} left-0`} style={{ top: hole.top, width: hole.left, height: hole.height }} />
      <div className={`${shade} right-0`} style={{ top: hole.top, left: hole.left + hole.width, height: hole.height }} />
      <div className={`${shade} inset-x-0 bottom-0`} style={{ top: hole.top + hole.height }} />
      <div
        className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-[top,left,width,height] duration-200"
        style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
      />

      <div
        ref={cardRef}
        className="absolute flex w-80 flex-col gap-1.5 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg"
        style={{ top: position.top, left: position.left }}
      >
        <p className="text-xs text-muted-foreground tabular-nums">
          {t('workspaceTour.progress', { current: index + 1, total: steps.length })}
        </p>
        <h2 id="workspace-tour-title" className="text-sm font-semibold">{t(step.title)}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t(step.body, { shortcut: `${mod}${mod === '⌘' ? '' : '+'}K` })}
        </p>
        <div className="mt-2 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={close}>{t('workspaceTour.skip')}</Button>
          <div className="flex gap-2">
            {index > 0 && <Button variant="outline" size="sm" onClick={back}>{t('workspaceTour.back')}</Button>}
            <Button size="sm" onClick={next} autoFocus>{t(last ? 'workspaceTour.done' : 'workspaceTour.next')}</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
