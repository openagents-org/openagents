'use client';

import { Check } from 'lucide-react';
import { BLUE, TEAL, INK, BORDER, MUTED, FAINT, TRACK, SUBTLE, AMBER, WASH, FONT, EASE, Stamp, Dot } from './tour-scene-parts';

// ── Tasks: assign a card → it moves across the board as the agent works ──
export function TasksScene({ ms }: { ms: number }) {
  // the card lives in exactly one column at a time
  const col = ms < 1400 ? 0 : ms < 3400 ? 1 : 2;
  const cols = ['To do', 'In progress', 'Done'];
  return (
    <div className="flex h-full gap-3 p-5" style={{ background: WASH, fontFamily: FONT }}>
      {cols.map((title, i) => (
        <div key={title} className="flex min-w-0 flex-1 flex-col rounded-xl p-2.5" style={{ background: 'var(--tour-lane)', border: `1px solid ${BORDER}` }}>
          <div className="px-1 pb-2 text-xs font-bold uppercase tracking-wide" style={{ color: MUTED }}>{title}</div>
          {col === i && (
            <div key={i} className="rounded-lg bg-(--tour-card) p-3" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 8px 22px rgba(11,17,33,0.10)', animation: `tour-in 0.35s ${EASE}` }}>
              <div className="text-xs font-semibold" style={{ color: INK }}>Fix flaky login test</div>
              <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: MUTED }}>
                <Dot size={16} color="#8B5CF6" />claude-dev
                {i === 1 && (
                  <span className="ml-auto flex items-center gap-1 font-medium" style={{ color: AMBER }}>
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
                <div className="mt-2 rounded-md px-2 py-1 font-mono text-xs" style={{ background: SUBTLE, border: `1px solid ${BORDER}`, color: MUTED }}>
                  {i === 1 ? '▸ reproducing on CI…' : '▸ waited for animation frame — 40 green runs'}
                </div>
              )}
            </div>
          )}
          {i === 0 && ms >= 600 && col !== 0 && (
            <div className="rounded-lg border border-dashed p-3 text-center text-xs" style={{ borderColor: TRACK, color: FAINT }}>
              assigned → agent picked it up
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Workflows: a pipeline hands work agent → agent → agent ──
export function WorkflowsScene({ ms }: { ms: number }) {
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
                <div className="w-44 rounded-xl bg-(--tour-card) p-3.5" style={{
                  border: `2px solid ${running ? BLUE : done ? TEAL : BORDER}`,
                  boxShadow: running ? '0 10px 30px rgba(47,107,255,0.18)' : '0 10px 30px rgba(11,17,33,0.08)',
                  transition: 'border-color 0.3s, box-shadow 0.3s',
                }}>
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: MUTED }}>
                    Step {i + 1}
                    <span className="ml-auto">
                      {done ? <Check className="size-3.5" style={{ color: TEAL }} />
                        : running ? <span className="block size-3 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: `${BLUE} transparent ${BLUE} ${BLUE}` }} />
                        : null}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-bold" style={{ color: INK }}>{s.name}</div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs" style={{ color: MUTED }}>
                    <Dot size={14} color={s.color} />{s.agent}
                  </div>
                </div>
              </Stamp>
              {i < steps.length - 1 && (
                <span className="text-lg font-black transition-colors duration-300" style={{ color: ms >= steps[i + 1].at ? BLUE : TRACK }}>→</span>
              )}
            </div>
          );
        })}
      </div>
      <Stamp show={ms >= 4400}>
        <div className="flex items-center gap-2 rounded-full bg-(--tour-card) px-4 py-2 text-xs font-semibold" style={{ border: `1px solid ${BORDER}`, boxShadow: '0 10px 30px rgba(11,17,33,0.10)', color: INK }}>
          <Check className="size-4" style={{ color: TEAL }} />launch-post.md — three agents, one pipeline, zero handoffs by hand
        </div>
      </Stamp>
    </div>
  );
}
