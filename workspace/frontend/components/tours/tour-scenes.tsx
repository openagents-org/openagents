'use client';

import { Globe, CalendarClock, Check } from 'lucide-react';
import { BLUE, TEAL, INK, BORDER, MUTED, TRACK, SUBTLE, TINT, WASH, FONT, Stamp, Dot } from './tour-scene-parts';

// ── Routines: schedule → agent runs alone → digest lands in the thread ──
export function RoutinesScene({ ms }: { ms: number }) {
  const toggled = ms >= 900;
  return (
    <div className="flex h-full gap-4 p-5" style={{ background: WASH, fontFamily: FONT }}>
      <div className="w-[46%] shrink-0">
        <Stamp show={ms >= 150}>
          <div className="rounded-xl bg-(--tour-card) p-4" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 10px 30px rgba(11,17,33,0.08)' }}>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg" style={{ background: TINT, color: BLUE }}>
                <CalendarClock className="size-4" />
              </span>
              <span className="text-sm font-bold" style={{ color: INK }}>Morning digest</span>
              <span className="ml-auto inline-flex h-5 w-9 items-center rounded-full px-0.5 transition-colors duration-300"
                style={{ background: toggled ? TEAL : TRACK }}>
                <span className="size-4 rounded-full bg-white shadow transition-transform duration-300"
                  style={{ transform: toggled ? 'translateX(16px)' : 'translateX(0)' }} />
              </span>
            </div>
            <div className="mt-3 flex flex-col items-start gap-2 text-xs" style={{ color: MUTED }}>
              <span className="inline-block rounded-md bg-(--tour-chip) px-1.5 py-0.5 font-mono text-xs" style={{ color: INK }}>Every day · 09:00</span>
              <p>Summarize new PRs, failing tests and due tasks. Post to <span style={{ color: BLUE }}>#general</span>.</p>
              <div className="flex items-center gap-1.5">
                <Dot size={16} /><span className="font-medium" style={{ color: INK }}>posthog-analyst</span><span>runs it</span>
              </div>
            </div>
            <Stamp show={toggled}>
              <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold" style={{ color: TEAL }}>
                <Check className="size-3.5" />Scheduled — next run 09:00
              </div>
            </Stamp>
          </div>
        </Stamp>
        <Stamp show={ms >= 1600}>
          <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: MUTED }}>
            <span className="rounded-full bg-(--tour-card) px-2 py-0.5 font-mono" style={{ border: `1px solid ${BORDER}` }}>⏰ 09:00</span>
            the routine wakes the agent — no one at the keyboard
          </div>
        </Stamp>
      </div>
      <div className="flex min-w-0 flex-1 flex-col rounded-xl bg-(--tour-card)" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 10px 30px rgba(11,17,33,0.08)' }}>
        <div className="flex items-center gap-1.5 px-3.5" style={{ height: 36, borderBottom: `1px solid ${BORDER}` }}>
          <span className="text-xs font-semibold" style={{ color: INK }}>#general</span>
          <span className="ml-auto text-xs" style={{ color: MUTED }}>09:00</span>
        </div>
        <div className="flex-1 flex flex-col gap-3 p-3.5 text-xs">
          <Stamp show={ms >= 2300}>
            <div className="flex items-start gap-2">
              <Dot />
              <div>
                <span className="font-semibold" style={{ color: INK }}>posthog-analyst</span>
                <span className="ml-1.5 rounded px-1 py-px text-xs font-bold uppercase" style={{ background: TINT, color: BLUE }}>routine</span>
                <p className="mt-0.5 leading-relaxed" style={{ color: INK }}>
                  ☀️ Morning digest — 3 PRs merged overnight, 1 flaky test on CI, 2 tasks due today.
                </p>
              </div>
            </div>
          </Stamp>
          <Stamp show={ms >= 3300}>
            <div className="ml-7 rounded-lg px-2.5 py-1.5 font-mono text-xs" style={{ background: SUBTLE, border: `1px solid ${BORDER}`, color: MUTED }}>
              📎 digest-2026-08-28.md · full report in /files
            </div>
          </Stamp>
          <Stamp show={ms >= 4100}>
            <div className="ml-7 flex items-center gap-1.5 text-xs font-semibold" style={{ color: TEAL }}>
              <Check className="size-3.5" />Ran on schedule · next 09:00 tomorrow
            </div>
          </Stamp>
        </div>
      </div>
    </div>
  );
}

// ── Shared Browser: ask in chat → agent drives a live page you both see ──
export function BrowserScene({ ms }: { ms: number }) {
  const rows = [
    { at: 2200, name: 'CRM Alpha', price: '$29', note: 'per seat / mo' },
    { at: 2700, name: 'PipeDream', price: '$39', note: 'per seat / mo' },
    { at: 3200, name: 'SellWell', price: '$25', note: 'flat, 10 seats' },
  ];
  return (
    <div className="flex h-full gap-4 p-5" style={{ background: WASH, fontFamily: FONT }}>
      <div className="flex w-[40%] shrink-0 flex-col rounded-xl bg-(--tour-card)" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 10px 30px rgba(11,17,33,0.08)' }}>
        <div className="px-3.5 text-xs font-semibold" style={{ lineHeight: '36px', borderBottom: `1px solid ${BORDER}`, color: INK }}>vendor-research</div>
        <div className="flex-1 flex flex-col gap-3 p-3.5 text-xs">
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
                <div className="mt-1.5 rounded-lg px-2.5 py-1 font-mono text-xs" style={{ background: SUBTLE, border: `1px solid ${BORDER}`, color: MUTED }}>
                  🌐 Browse › crm-alpha.com/pricing
                </div>
              </div>
            </div>
          </Stamp>
          <Stamp show={ms >= 4100}>
            <div className="ml-7 flex items-center gap-1.5 text-xs font-semibold" style={{ color: TEAL }}>
              <Check className="size-3.5" />Comparison ready — sheet in /files
            </div>
          </Stamp>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col rounded-xl bg-(--tour-card)" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 10px 30px rgba(11,17,33,0.08)' }}>
        <div className="flex items-center gap-2 px-3.5" style={{ height: 36, borderBottom: `1px solid ${BORDER}` }}>
          <Globe className="size-3.5" style={{ color: MUTED }} />
          <span className="rounded bg-(--tour-chip) px-1.5 py-0.5 font-mono text-xs" style={{ color: INK }}>crm-alpha.com/pricing</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs font-medium" style={{ color: ms >= 4100 ? '#0E9F6E' : MUTED }}>
            <span className="size-1.5 rounded-full" style={{ background: ms >= 4100 ? '#0E9F6E' : TEAL }} />
            {ms >= 4100 ? 'done — take over anytime' : 'pi-agent controlling'}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center gap-3 p-4" style={{ background: SUBTLE }}>
          {rows.map((r) => (
            <Stamp key={r.name} show={ms >= r.at}>
              <div className="w-36 rounded-xl bg-(--tour-card) p-3 text-center" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 6px 18px rgba(11,17,33,0.06)' }}>
                <div className="text-xs font-semibold" style={{ color: MUTED }}>{r.name}</div>
                <div className="mt-1 text-2xl font-black" style={{ color: INK }}>{r.price}</div>
                <div className="text-xs" style={{ color: MUTED }}>{r.note}</div>
                <Stamp show={ms >= 3700}>
                  <div className="mt-1.5 text-xs font-semibold" style={{ color: r.name === 'SellWell' ? TEAL : TRACK }}>
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
