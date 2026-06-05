'use client';

import { useState, useEffect, useCallback } from 'react';
import { AgentIcon } from '@/components/icons/agent-icons';
import { cn } from '@/lib/utils';
import { RotateCcw } from 'lucide-react';

const AGENTS = [
  { name: 'claude', label: 'Claude' },
  { name: 'cursor', label: 'Cursor' },
  { name: 'gemini', label: 'Gemini' },
] as const;

const BEATS = [
  { at: 0 },      // 0: blank
  { at: 400 },    // 1: first agent
  { at: 1600 },   // 2: second agent
  { at: 2800 },   // 3: third agent — all visible, pause
  { at: 4600 },   // 4: cross-dissolve to "collaborate"
  { at: 7400 },   // 5: cross-dissolve to "share"
  { at: 10200 },  // 6: cross-dissolve to "focus"
  { at: 12600 },  // 7: cross-dissolve to reveal
];
const TOTAL = 15200;
const DISSOLVE = 800;

export function OnboardingAnimation({ onComplete }: { onComplete: () => void }) {
  const [beat, setBeat] = useState(-1);
  const [dissolving, setDissolving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [key, setKey] = useState(0);

  useEffect(() => {
    setBeat(-1);
    setDissolving(false);
    setProgress(0);
    setDismissed(false);
    setFinished(false);

    const timers = BEATS.map((b, i) => {
      if (i <= 3) {
        return setTimeout(() => setBeat(i), b.at);
      }
      return setTimeout(() => {
        setDissolving(true);
        setTimeout(() => { setBeat(i); setDissolving(false); }, DISSOLVE);
      }, b.at);
    });

    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + 100 / (TOTAL / 50), 100));
    }, 50);

    const done = setTimeout(() => setFinished(true), TOTAL);
    return () => { timers.forEach(clearTimeout); clearInterval(interval); clearTimeout(done); };
  }, [key]);

  const handleSkip = useCallback(() => {
    setDismissed(true);
    setTimeout(onComplete, 600);
  }, [onComplete]);

  const handleReplay = useCallback(() => setKey((k) => k + 1), []);

  const scene = beat <= 3 ? 'agents' : beat === 4 ? 'collaborate' : beat === 5 ? 'share' : beat === 6 ? 'focus' : 'reveal';

  return (
    <div
      className={cn('fixed inset-0 z-[100] flex flex-col bg-white overflow-hidden')}
      style={{
        opacity: dismissed ? 0 : 1,
        transition: 'opacity 600ms ease',
      }}
    >
      {/* Content area */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <div
          className="w-full h-full flex items-center justify-center"
          style={{
            opacity: dissolving ? 0 : 1,
            transition: `opacity ${DISSOLVE}ms ease`,
          }}
        >
          {scene === 'agents' && <BeatAgents visibleCount={beat + 1} />}
          {scene === 'collaborate' && <BeatText line1="They collaborate" line2="in real time." />}
          {scene === 'share' && <BeatText line1="They share files," line2="browse the web, run tasks." />}
          {scene === 'focus' && <BeatText line1="While you focus" line2="on what matters." />}
          {scene === 'reveal' && <BeatReveal />}
        </div>
      </div>

      {/* Minimal bottom bar */}
      <div className="shrink-0 px-8 pb-8 pt-2">
        <div className="max-w-xs mx-auto flex items-center gap-6">
          {/* Progress line */}
          <div className="flex-1 h-px bg-zinc-200 overflow-hidden rounded-full">
            <div
              className="h-full bg-zinc-400 rounded-full"
              style={{ width: `${progress}%`, transition: 'width 50ms linear' }}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 shrink-0">
            {finished && (
              <button
                onClick={handleReplay}
                className="text-[12px] text-zinc-300 hover:text-zinc-500 transition-colors"
                style={{ animation: 'onb-fadein 0.6s ease both' }}
              >
                <RotateCcw className="size-3.5" />
              </button>
            )}
            <button
              onClick={handleSkip}
              className="text-[12px] text-zinc-400 hover:text-zinc-600 transition-colors font-medium"
            >
              {finished ? 'Get Started' : 'Skip'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes onb-fadein {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Beat: Agents appear one by one
   ═══════════════════════════════════════════════ */

function BeatAgents({ visibleCount }: { visibleCount: number }) {
  return (
    <div className="flex items-center justify-center gap-12 sm:gap-20 px-8">
      {AGENTS.map((agent, i) => {
        const visible = i < visibleCount;
        return (
          <div
            key={agent.name}
            className="flex flex-col items-center gap-4"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.96)',
              transition: 'all 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div className="size-24 sm:size-32 flex items-center justify-center">
              <AgentIcon name={agent.name} size={128} />
            </div>
            <span className="text-base sm:text-lg font-medium text-zinc-900 tracking-tight">
              {agent.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Beat: Full-screen text
   ═══════════════════════════════════════════════ */

function BeatText({ line1, line2 }: { line1: string; line2: string }) {
  return (
    <div className="text-center px-8">
      <h2 className="text-4xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-zinc-900 leading-[1.1]">
        <span
          className="block"
          style={{ animation: 'onb-fadein 0.8s cubic-bezier(0.16, 1, 0.3, 1) both' }}
        >
          {line1}
        </span>
        <span
          className="block text-zinc-400"
          style={{ animation: 'onb-fadein 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.15s both' }}
        >
          {line2}
        </span>
      </h2>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Beat: Final reveal
   ═══════════════════════════════════════════════ */

function BeatReveal() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 300);
    const t2 = setTimeout(() => setStep(2), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-10 sm:gap-14 px-8">
      {/* Agent icons in a tight row */}
      <div className="flex items-center gap-5 sm:gap-8">
        {AGENTS.map((agent, i) => (
          <div
            key={agent.name}
            className="size-16 sm:size-20 flex items-center justify-center"
            style={{
              opacity: step >= 0 ? 1 : 0,
              transform: step >= 0 ? 'scale(1)' : 'scale(0.8)',
              transition: 'all 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
              transitionDelay: `${i * 80}ms`,
            }}
          >
            <AgentIcon name={agent.name} size={80} />
          </div>
        ))}
      </div>

      {/* Tagline */}
      <div className="text-center">
        <h2
          className="text-4xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-zinc-900 leading-[1.1]"
          style={{
            opacity: step >= 1 ? 1 : 0,
            transform: step >= 1 ? 'translateY(0)' : 'translateY(12px)',
            transition: 'all 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          Your agents.
          <br />
          <span className="text-zinc-400">One workspace.</span>
        </h2>
      </div>

      {/* Subtitle */}
      <p
        className="text-sm sm:text-base text-zinc-400"
        style={{
          opacity: step >= 2 ? 1 : 0,
          transition: 'opacity 0.8s ease',
        }}
      >
        Connect your first agent to get started.
      </p>
    </div>
  );
}
