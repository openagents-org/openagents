'use client';

// Feature tours: a slim per-view banner ("Meet Routines — … ▶ Watch the 20s
// tour") that opens a full-screen tour in the welcome-deck visual language —
// big title over a framed animation that plays once and freezes on its
// closing illustration. Dismissal is per-feature, per-browser (localStorage).

import { useEffect, useState } from 'react';
import { Globe, CalendarClock, SquareKanban, Workflow, X, RotateCcw, Check, Play } from 'lucide-react';
import { capture } from '@/lib/analytics';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const BLUE = '#2F6BFF';
const TEAL = '#16C79A';
const INK = '#0A0A0A';
const BORDER = '#ececee';
const MUTED = '#71717a';
const WASH = 'linear-gradient(160deg, #eaf2ff 0%, #f4f8ff 40%, #ffffff 100%)';
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

export type TourFeature = 'browser' | 'routines' | 'tasks' | 'workflows';

// ── animation clock: plays once per `key`, clamps at total ──
function useClock(totalMs: number, key: string | number) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const v = now - t0;
      setMs(Math.min(v, totalMs));
      if (v < totalMs) raf = requestAnimationFrame(tick);
    };
    setMs(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, totalMs]);
  return ms;
}

function Stamp({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div style={{ visibility: show ? undefined : 'hidden', animation: show ? `tour-in 0.4s ${EASE} backwards` : undefined }}>
      {children}
    </div>
  );
}

function Dot({ color = '#6366F1', size = 20 }: { color?: string; size?: number }) {
  return <span className="shrink-0 rounded-full" style={{ width: size, height: size, background: color }} />;
}

// ── Routines: schedule → agent runs alone → digest lands in the thread ──
function RoutinesScene({ ms }: { ms: number }) {
  const toggled = ms >= 900;
  return (
    <div className="flex h-full gap-4 p-5" style={{ background: WASH, fontFamily: FONT }}>
      <div className="w-[46%] shrink-0">
        <Stamp show={ms >= 150}>
          <div className="rounded-xl bg-white p-4" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 10px 30px rgba(11,17,33,0.08)' }}>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg" style={{ background: '#eef3ff', color: BLUE }}>
                <CalendarClock className="size-4" />
              </span>
              <span className="text-[14px] font-bold" style={{ color: INK }}>Morning digest</span>
              <span className="ml-auto inline-flex h-5 w-9 items-center rounded-full px-0.5 transition-colors duration-300"
                style={{ background: toggled ? TEAL : '#d4d4d8' }}>
                <span className="size-4 rounded-full bg-white shadow transition-transform duration-300"
                  style={{ transform: toggled ? 'translateX(16px)' : 'translateX(0)' }} />
              </span>
            </div>
            <div className="mt-3 space-y-2 text-[12px]" style={{ color: MUTED }}>
              <span className="inline-block rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px]" style={{ color: INK }}>Every day · 09:00</span>
              <p>Summarize new PRs, failing tests and due tasks. Post to <span style={{ color: BLUE }}>#general</span>.</p>
              <div className="flex items-center gap-1.5">
                <Dot size={16} /><span className="font-medium" style={{ color: INK }}>posthog-analyst</span><span>runs it</span>
              </div>
            </div>
            <Stamp show={toggled}>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: TEAL }}>
                <Check className="size-3.5" />Scheduled — next run 09:00
              </div>
            </Stamp>
          </div>
        </Stamp>
        <Stamp show={ms >= 1600}>
          <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: MUTED }}>
            <span className="rounded-full bg-white px-2 py-0.5 font-mono" style={{ border: `1px solid ${BORDER}` }}>⏰ 09:00</span>
            the routine wakes the agent — no one at the keyboard
          </div>
        </Stamp>
      </div>
      <div className="flex min-w-0 flex-1 flex-col rounded-xl bg-white" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 10px 30px rgba(11,17,33,0.08)' }}>
        <div className="flex items-center gap-1.5 px-3.5" style={{ height: 36, borderBottom: `1px solid ${BORDER}` }}>
          <span className="text-[12px] font-semibold" style={{ color: INK }}>#general</span>
          <span className="ml-auto text-[10px]" style={{ color: MUTED }}>09:00</span>
        </div>
        <div className="flex-1 space-y-3 p-3.5 text-[12px]">
          <Stamp show={ms >= 2300}>
            <div className="flex items-start gap-2">
              <Dot />
              <div>
                <span className="font-semibold" style={{ color: INK }}>posthog-analyst</span>
                <span className="ml-1.5 rounded px-1 py-px text-[9px] font-bold uppercase" style={{ background: '#eef3ff', color: BLUE }}>routine</span>
                <p className="mt-0.5 leading-relaxed" style={{ color: INK }}>
                  ☀️ Morning digest — 3 PRs merged overnight, 1 flaky test on CI, 2 tasks due today.
                </p>
              </div>
            </div>
          </Stamp>
          <Stamp show={ms >= 3300}>
            <div className="ml-7 rounded-lg px-2.5 py-1.5 font-mono text-[10px]" style={{ background: '#fafafa', border: `1px solid ${BORDER}`, color: MUTED }}>
              📎 digest-2026-08-28.md · full report in /files
            </div>
          </Stamp>
          <Stamp show={ms >= 4100}>
            <div className="ml-7 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: TEAL }}>
              <Check className="size-3.5" />Ran on schedule · next 09:00 tomorrow
            </div>
          </Stamp>
        </div>
      </div>
    </div>
  );
}

// ── Shared Browser: ask in chat → agent drives a live page you both see ──
function BrowserScene({ ms }: { ms: number }) {
  const rows = [
    { at: 2200, name: 'CRM Alpha', price: '$29', note: 'per seat / mo' },
    { at: 2700, name: 'PipeDream', price: '$39', note: 'per seat / mo' },
    { at: 3200, name: 'SellWell', price: '$25', note: 'flat, 10 seats' },
  ];
  return (
    <div className="flex h-full gap-4 p-5" style={{ background: WASH, fontFamily: FONT }}>
      <div className="flex w-[40%] shrink-0 flex-col rounded-xl bg-white" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 10px 30px rgba(11,17,33,0.08)' }}>
        <div className="px-3.5 text-[12px] font-semibold" style={{ lineHeight: '36px', borderBottom: `1px solid ${BORDER}`, color: INK }}>vendor-research</div>
        <div className="flex-1 space-y-3 p-3.5 text-[12px]">
          <Stamp show={ms >= 150}>
            <div>
              <span className="font-semibold" style={{ color: INK }}>You</span>
              <p className="mt-0.5" style={{ color: INK }}><span style={{ color: BLUE }}>@pi-agent</span> compare pricing for 3 CRM vendors</p>
            </div>
          </Stamp>
          <Stamp show={ms >= 900}>
            <div className="flex items-start gap-2">
              <Dot color="#10B981" />
              <div>
                <span className="font-semibold" style={{ color: INK }}>pi-agent</span>
                <p className="mt-0.5" style={{ color: MUTED }}>On it — opening their pricing pages in the shared browser.</p>
                <div className="mt-1.5 rounded-lg px-2.5 py-1 font-mono text-[10px]" style={{ background: '#fafafa', border: `1px solid ${BORDER}`, color: MUTED }}>
                  🌐 Browse › crm-alpha.com/pricing
                </div>
              </div>
            </div>
          </Stamp>
          <Stamp show={ms >= 4100}>
            <div className="ml-7 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: TEAL }}>
              <Check className="size-3.5" />Comparison ready — sheet in /files
            </div>
          </Stamp>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col rounded-xl bg-white" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 10px 30px rgba(11,17,33,0.08)' }}>
        <div className="flex items-center gap-2 px-3.5" style={{ height: 36, borderBottom: `1px solid ${BORDER}` }}>
          <Globe className="size-3.5" style={{ color: MUTED }} />
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px]" style={{ color: INK }}>crm-alpha.com/pricing</span>
          <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium" style={{ color: ms >= 4100 ? '#0E9F6E' : MUTED }}>
            <span className="size-1.5 rounded-full" style={{ background: ms >= 4100 ? '#0E9F6E' : TEAL }} />
            {ms >= 4100 ? 'done — take over anytime' : 'pi-agent controlling'}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center gap-3 p-4" style={{ background: '#fafafa' }}>
          {rows.map((r) => (
            <Stamp key={r.name} show={ms >= r.at}>
              <div className="w-36 rounded-xl bg-white p-3 text-center" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 6px 18px rgba(11,17,33,0.06)' }}>
                <div className="text-[11px] font-semibold" style={{ color: MUTED }}>{r.name}</div>
                <div className="mt-1 text-[22px] font-black" style={{ color: INK }}>{r.price}</div>
                <div className="text-[10px]" style={{ color: MUTED }}>{r.note}</div>
                <Stamp show={ms >= 3700}>
                  <div className="mt-1.5 text-[10px] font-semibold" style={{ color: r.name === 'SellWell' ? TEAL : '#d4d4d8' }}>
                    {r.name === 'SellWell' ? '✓ best value' : 'noted'}
                  </div>
                </Stamp>
              </div>
            </Stamp>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tasks: assign a card → it moves across the board as the agent works ──
function TasksScene({ ms }: { ms: number }) {
  // the card lives in exactly one column at a time
  const col = ms < 1400 ? 0 : ms < 3400 ? 1 : 2;
  const cols = ['To do', 'In progress', 'Done'];
  return (
    <div className="flex h-full gap-3 p-5" style={{ background: WASH, fontFamily: FONT }}>
      {cols.map((title, i) => (
        <div key={title} className="flex min-w-0 flex-1 flex-col rounded-xl p-2.5" style={{ background: 'rgba(255,255,255,0.72)', border: `1px solid ${BORDER}` }}>
          <div className="px-1 pb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{title}</div>
          {col === i && (
            <div key={i} className="rounded-lg bg-white p-3" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 8px 22px rgba(11,17,33,0.10)', animation: `tour-in 0.35s ${EASE}` }}>
              <div className="text-[12px] font-semibold" style={{ color: INK }}>Fix flaky login test</div>
              <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: MUTED }}>
                <Dot size={16} color="#8B5CF6" />claude-dev
                {i === 1 && (
                  <span className="ml-auto flex items-center gap-1 font-medium" style={{ color: '#b45309' }}>
                    <span className="flex gap-0.5">
                      {[0, 1, 2].map((d) => (
                        <span key={d} className="size-1 rounded-full" style={{ background: '#f59e0b', animation: `tour-blink 1s ease-in-out ${d * 0.2}s infinite` }} />
                      ))}
                    </span>
                    working
                  </span>
                )}
                {i === 2 && <span className="ml-auto flex items-center gap-1 font-semibold" style={{ color: TEAL }}><Check className="size-3.5" />PR #214 merged</span>}
              </div>
              {i >= 1 && (
                <div className="mt-2 rounded-md px-2 py-1 font-mono text-[10px]" style={{ background: '#fafafa', border: `1px solid ${BORDER}`, color: MUTED }}>
                  {i === 1 ? '▸ reproducing on CI…' : '▸ waited for animation frame — 40 green runs'}
                </div>
              )}
            </div>
          )}
          {i === 0 && ms >= 600 && col !== 0 && (
            <div className="rounded-lg border border-dashed p-3 text-center text-[10px]" style={{ borderColor: '#d4d4d8', color: '#a1a1aa' }}>
              assigned → agent picked it up
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Workflows: a pipeline hands work agent → agent → agent ──
function WorkflowsScene({ ms }: { ms: number }) {
  const steps = [
    { at: 600, doneAt: 1800, name: 'Research', agent: 'pi-agent', color: '#10B981' },
    { at: 1800, doneAt: 3000, name: 'Draft', agent: 'claude-dev', color: '#8B5CF6' },
    { at: 3000, doneAt: 4200, name: 'Review', agent: 'openclaw-qa', color: '#06B6D4' },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6" style={{ background: WASH, fontFamily: FONT }}>
      <div className="flex items-center gap-3">
        {steps.map((s, i) => {
          const running = ms >= s.at && ms < s.doneAt;
          const done = ms >= s.doneAt;
          return (
            <div key={s.name} className="flex items-center gap-3">
              <Stamp show={ms >= 150 + i * 150}>
                <div className="w-44 rounded-xl bg-white p-3.5" style={{
                  border: `2px solid ${running ? BLUE : done ? TEAL : BORDER}`,
                  boxShadow: running ? '0 10px 30px rgba(47,107,255,0.18)' : '0 10px 30px rgba(11,17,33,0.08)',
                  transition: 'border-color 0.3s, box-shadow 0.3s',
                }}>
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
                    Step {i + 1}
                    <span className="ml-auto">
                      {done ? <Check className="size-3.5" style={{ color: TEAL }} />
                        : running ? <span className="block size-3 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: `${BLUE} transparent ${BLUE} ${BLUE}` }} />
                        : null}
                    </span>
                  </div>
                  <div className="mt-1 text-[14px] font-bold" style={{ color: INK }}>{s.name}</div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: MUTED }}>
                    <Dot size={14} color={s.color} />{s.agent}
                  </div>
                </div>
              </Stamp>
              {i < steps.length - 1 && (
                <span className="text-[18px] font-black transition-colors duration-300" style={{ color: ms >= steps[i + 1].at ? BLUE : '#d4d4d8' }}>→</span>
              )}
            </div>
          );
        })}
      </div>
      <Stamp show={ms >= 4400}>
        <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[12px] font-semibold" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 10px 30px rgba(11,17,33,0.10)', color: INK }}>
          <Check className="size-4" style={{ color: TEAL }} />launch-post.md — three agents, one pipeline, zero handoffs by hand
        </div>
      </Stamp>
    </div>
  );
}

const TOUR_META: Record<TourFeature, { icon: React.ComponentType<{ className?: string }>; dur: number; Scene: React.ComponentType<{ ms: number }> }> = {
  browser: { icon: Globe, dur: 5_200, Scene: BrowserScene },
  routines: { icon: CalendarClock, dur: 5_000, Scene: RoutinesScene },
  tasks: { icon: SquareKanban, dur: 5_000, Scene: TasksScene },
  workflows: { icon: Workflow, dur: 5_200, Scene: WorkflowsScene },
};

export function FeatureTourOverlay({ feature, onClose }: { feature: TourFeature; onClose: () => void }) {
  const t = useT();
  const [playKey, setPlayKey] = useState(0);
  const meta = TOUR_META[feature];
  const ms = useClock(meta.dur, `${feature}-${playKey}`);
  return (
    <div className="fixed inset-0 z-[100] bg-white" style={{ fontFamily: FONT }}>
      <div className="flex h-full flex-col items-center overflow-hidden pt-12">
        <Stamp show={ms >= 80}>
          <span className="inline-block rounded-full px-3.5 py-1 text-[12px] font-extrabold uppercase tracking-wider"
            style={{ background: BLUE, color: '#fff', border: '2px solid #000', boxShadow: '3px 3px 0 0 #000' }}>
            {t('featureTours.kicker')}
          </span>
        </Stamp>
        <Stamp show={ms >= 250}>
          <h1 className="mt-4 text-[44px] font-black leading-none tracking-tight sm:text-[54px]" style={{ color: INK }}>
            {t(`featureTours.${feature}Title`)}
          </h1>
        </Stamp>
        <div className="mt-7 overflow-hidden rounded-2xl"
          style={{
            width: 'min(900px, 94vw)', height: 'min(520px, 56vh)',
            border: `1px solid ${BORDER}`, boxShadow: '0 18px 50px rgba(11,17,33,0.14)',
            visibility: ms >= 450 ? undefined : 'hidden',
            animation: ms >= 450 ? `tour-card-up 0.5s ${EASE} backwards` : undefined,
          }}>
          <meta.Scene ms={Math.max(0, ms - 450)} />
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-5 pb-4 sm:px-6 sm:pb-5">
        <button onClick={() => setPlayKey((k) => k + 1)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800">
          <RotateCcw className="size-4" />{t('featureTours.replay')}
        </button>
        <button onClick={onClose}
          className="flex h-10 items-center gap-1.5 rounded-full px-6 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          style={{ background: BLUE }}>
          {t('featureTours.done')}
        </button>
      </div>

      <style>{`
        @keyframes tour-in { 0% { opacity: 0; transform: translateY(10px) scale(0.98); } 100% { opacity: 1; transform: none; } }
        @keyframes tour-card-up { 0% { opacity: 0; transform: translateY(36px) scale(0.97); } 100% { opacity: 1; transform: none; } }
        @keyframes tour-blink { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
      `}</style>
    </div>
  );
}

const bannerKey = (feature: TourFeature) => `oa:tourBanner:${feature}`;

/**
 * Drop-in banner for a feature view's top edge. Self-contained: manages its
 * own dismissal flag and renders the tour overlay itself. `compact` stacks
 * the layout for narrow list panels (e.g. the routines rail).
 */
export function FeatureTourBanner({ feature, compact = false }: { feature: TourFeature; compact?: boolean }) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [open, setOpen] = useState(false);
  const meta = TOUR_META[feature];

  useEffect(() => {
    try { setDismissed(localStorage.getItem(bannerKey(feature)) === '1'); } catch { setDismissed(false); }
    setMounted(true);
  }, [feature]);

  const dismiss = () => {
    try { localStorage.setItem(bannerKey(feature), '1'); } catch {}
    capture('feature_tour_banner_dismissed', { feature });
    setDismissed(true);
  };
  const watch = () => {
    capture('feature_tour_opened', { feature });
    setOpen(true);
  };

  if (!mounted || dismissed) {
    return open ? <FeatureTourOverlay feature={feature} onClose={() => setOpen(false)} /> : null;
  }

  return (
    <>
      <div className={cn(
        'shrink-0 border-b px-3 py-2 text-[13px]',
        compact ? 'space-y-1.5' : 'flex items-center gap-2.5 px-4',
      )} style={{ background: 'linear-gradient(90deg, #eef3ff, #f6fbff)' }}>
        <div className={cn('flex min-w-0 items-center gap-2', !compact && 'contents')}>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-white" style={{ color: BLUE }}>
            <meta.icon className="size-4" />
          </span>
          <span className={cn('min-w-0 text-foreground', compact ? 'text-[12px] leading-snug' : 'truncate')}>
            {t(`featureTours.${feature}Banner`)}
          </span>
          {!compact && (
            <>
              <button onClick={watch}
                className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                style={{ background: BLUE }}>
                <Play className="size-3 fill-current" />{t('featureTours.watch')}
              </button>
              <button onClick={dismiss} aria-label={t('featureTours.dismiss')}
                className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-700">
                <X className="size-4" />
              </button>
            </>
          )}
        </div>
        {compact && (
          <div className="flex items-center gap-1.5">
            <button onClick={watch}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              style={{ background: BLUE }}>
              <Play className="size-3 fill-current" />{t('featureTours.watch')}
            </button>
            <button onClick={dismiss} aria-label={t('featureTours.dismiss')}
              className="ml-auto flex size-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-700">
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>
      {open && <FeatureTourOverlay feature={feature} onClose={() => setOpen(false)} />}
    </>
  );
}
