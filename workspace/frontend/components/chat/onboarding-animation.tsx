'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AgentIcon } from '@/components/icons/agent-icons';
import { cn } from '@/lib/utils';
import { RotateCcw } from 'lucide-react';

/* ═══════════════════════════════════════════════
   Config
   ═══════════════════════════════════════════════ */

const AGENTS = [
  { name: 'claude', label: 'Claude', color: '#6366f1' },
  { name: 'cursor', label: 'Cursor', color: '#a855f7' },
  { name: 'gemini', label: 'Gemini', color: '#10b981' },
] as const;

const BEAT_TIMES = [0, 500, 1500, 2500, 4000, 7200, 10400, 13000];
const TOTAL = 15500;
const DISSOLVE = 900;

/* ═══════════════════════════════════════════════
   Main
   ═══════════════════════════════════════════════ */

export function OnboardingAnimation({ onComplete }: { onComplete: () => void }) {
  const [beat, setBeat] = useState(-1);
  const [dissolving, setDissolving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [iteration, setIteration] = useState(0);

  useEffect(() => {
    setBeat(-1); setDissolving(false); setProgress(0); setDismissed(false); setFinished(false);

    const timers = BEAT_TIMES.map((t, i) => {
      if (i <= 3) return setTimeout(() => setBeat(i), t);
      return setTimeout(() => {
        setDissolving(true);
        setTimeout(() => { setBeat(i); setDissolving(false); }, DISSOLVE);
      }, t);
    });
    const interval = setInterval(() => setProgress((p) => Math.min(p + 100 / (TOTAL / 50), 100)), 50);
    const done = setTimeout(() => setFinished(true), TOTAL);
    return () => { timers.forEach(clearTimeout); clearInterval(interval); clearTimeout(done); };
  }, [iteration]);

  const handleSkip = useCallback(() => { setDismissed(true); setTimeout(onComplete, 600); }, [onComplete]);
  const handleReplay = useCallback(() => setIteration((n) => n + 1), []);

  const scene = beat <= 3 ? 'connect' : beat === 4 ? 'collaborate' : beat === 5 ? 'share' : beat === 6 ? 'automate' : 'reveal';

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white overflow-hidden" style={{ opacity: dismissed ? 0 : 1, transition: 'opacity 600ms ease' }}>
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <div className="w-full h-full flex items-center justify-center" style={{ opacity: dissolving ? 0 : 1, transition: `opacity ${DISSOLVE}ms ease` }}>
          {scene === 'connect' && <SceneConnect agentCount={Math.max(0, beat)} />}
          {scene === 'collaborate' && <SceneCollaborate />}
          {scene === 'share' && <SceneShare />}
          {scene === 'automate' && <SceneAutomate />}
          {scene === 'reveal' && <SceneReveal />}
        </div>
      </div>

      {/* Bottom */}
      <div className="shrink-0 px-8 pb-7 pt-2">
        <div className="max-w-xs mx-auto flex items-center gap-5">
          <div className="flex-1 h-px bg-zinc-100 overflow-hidden rounded-full">
            <div className="h-full bg-zinc-300 rounded-full" style={{ width: `${progress}%`, transition: 'width 50ms linear' }} />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {finished && (
              <button onClick={handleReplay} className="text-zinc-300 hover:text-zinc-500 transition-colors" style={{ animation: 'onb-fade 0.6s ease both' }}>
                <RotateCcw className="size-3.5" />
              </button>
            )}
            <button onClick={handleSkip} className="text-[12px] text-zinc-400 hover:text-zinc-600 transition-colors font-medium">
              {finished ? 'Get Started' : 'Skip'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes onb-fade { from { opacity:0 } to { opacity:1 } }
        @keyframes onb-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
        @keyframes onb-orbit { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes onb-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
        @keyframes onb-pulse { 0%,100% { opacity: 0.5; transform: scale(1) } 50% { opacity: 1; transform: scale(1.15) } }
        @keyframes onb-drift-0 { 0% { transform: translate(0,0) } 33% { transform: translate(12px,-8px) } 66% { transform: translate(-6px,10px) } 100% { transform: translate(0,0) } }
        @keyframes onb-drift-1 { 0% { transform: translate(0,0) } 33% { transform: translate(-10px,12px) } 66% { transform: translate(8px,-6px) } 100% { transform: translate(0,0) } }
        @keyframes onb-drift-2 { 0% { transform: translate(0,0) } 33% { transform: translate(8px,10px) } 66% { transform: translate(-12px,-4px) } 100% { transform: translate(0,0) } }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Scene 1 — Agents appear & connect
   Network lines draw between them
   ═══════════════════════════════════════════════ */

function SceneConnect({ agentCount }: { agentCount: number }) {
  const [linesDrawn, setLinesDrawn] = useState(false);

  useEffect(() => {
    if (agentCount >= 3) {
      const t = setTimeout(() => setLinesDrawn(true), 400);
      return () => clearTimeout(t);
    }
  }, [agentCount]);

  // Agent positions (relative to center) for a triangle layout
  const positions = [
    { x: 0, y: -70 },    // top center
    { x: -90, y: 55 },   // bottom left
    { x: 90, y: 55 },    // bottom right
  ];

  return (
    <div className="relative flex flex-col items-center justify-center gap-8">
      {/* Connection network */}
      <div className="relative" style={{ width: 280, height: 240 }}>
        {/* SVG lines between agents */}
        <svg className="absolute inset-0" viewBox="-140 -120 280 240" fill="none">
          {linesDrawn && (
            <>
              {[[0,1],[1,2],[2,0]].map(([a, b], i) => (
                <line
                  key={i}
                  x1={positions[a].x} y1={positions[a].y}
                  x2={positions[b].x} y2={positions[b].y}
                  stroke={`url(#grad-${i})`}
                  strokeWidth="1.5"
                  strokeDasharray="1"
                  pathLength="1"
                  style={{ animation: `onb-draw 1s cubic-bezier(0.16,1,0.3,1) ${i * 0.15}s both` }}
                />
              ))}
              {/* Gradient defs */}
              <defs>
                {[[0,1],[1,2],[2,0]].map(([a, b], i) => (
                  <linearGradient key={i} id={`grad-${i}`} x1={positions[a].x} y1={positions[a].y} x2={positions[b].x} y2={positions[b].y} gradientUnits="userSpaceOnUse">
                    <stop stopColor={AGENTS[a].color} stopOpacity="0.4" />
                    <stop offset="1" stopColor={AGENTS[b].color} stopOpacity="0.4" />
                  </linearGradient>
                ))}
              </defs>
              {/* Glow dots at each agent position */}
              {positions.map((pos, i) => (
                <circle
                  key={`dot-${i}`}
                  cx={pos.x} cy={pos.y} r="4"
                  fill={AGENTS[i].color}
                  opacity="0.3"
                  style={{ animation: 'onb-pulse 2s ease-in-out infinite', animationDelay: `${i * 0.3}s` }}
                />
              ))}
            </>
          )}
        </svg>

        {/* Agent icons */}
        {AGENTS.map((agent, i) => {
          const visible = i < agentCount;
          const pos = positions[i];
          return (
            <div
              key={agent.name}
              className="absolute flex flex-col items-center gap-2"
              style={{
                left: `calc(50% + ${pos.x}px)`,
                top: `calc(50% + ${pos.y}px)`,
                transform: `translate(-50%, -50%) ${visible ? 'scale(1)' : 'scale(0.7)'}`,
                opacity: visible ? 1 : 0,
                transition: 'all 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <div
                className="size-20 sm:size-24 flex items-center justify-center rounded-full"
                style={{ animation: visible ? `onb-drift-${i} ${15 + i * 3}s ease-in-out infinite` : 'none' }}
              >
                <AgentIcon name={agent.name} size={96} />
              </div>
              <span className="text-sm font-medium text-zinc-700 tracking-tight">{agent.label}</span>
            </div>
          );
        })}
      </div>

      {/* Caption */}
      <p
        className="text-lg sm:text-xl text-zinc-400 font-medium tracking-tight text-center"
        style={{
          opacity: agentCount >= 3 && linesDrawn ? 1 : 0,
          transform: agentCount >= 3 && linesDrawn ? 'translateY(0)' : 'translateY(8px)',
          transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        Connected.
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Scene 2 — Collaborate
   Chat bubbles float between agent icons
   ═══════════════════════════════════════════════ */

function SceneCollaborate() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 200);
    const t2 = setTimeout(() => setStep(2), 800);
    const t3 = setTimeout(() => setStep(3), 1600);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // Agents in a horizontal line, messages flow between them
  return (
    <div className="flex flex-col items-center justify-center gap-12 px-8">
      {/* Visual: agents with flowing message bubbles */}
      <div className="relative flex items-center gap-16 sm:gap-24">
        {AGENTS.map((agent, i) => (
          <div
            key={agent.name}
            className="flex flex-col items-center gap-2 relative"
            style={{
              animation: `onb-drift-${i} ${14 + i * 2}s ease-in-out infinite`,
            }}
          >
            <div className="size-16 sm:size-20 flex items-center justify-center">
              <AgentIcon name={agent.name} size={80} />
            </div>
            <span className="text-xs font-medium text-zinc-400">{agent.label}</span>
          </div>
        ))}

        {/* Flowing message shapes between agents */}
        <svg className="absolute inset-0 pointer-events-none overflow-visible" style={{ left: -20, right: -20, top: '25%', width: 'calc(100% + 40px)', height: '50%' }}>
          {/* Message bubble shapes traveling between agents */}
          {[
            { from: 0, to: 1, delay: 0.3, color: AGENTS[0].color },
            { from: 1, to: 2, delay: 0.9, color: AGENTS[1].color },
            { from: 2, to: 0, delay: 1.5, color: AGENTS[2].color },
          ].map((msg, i) => (
            <g key={i} style={{ opacity: step >= i + 1 ? 1 : 0, transition: 'opacity 0.6s ease' }}>
              <rect
                x="0" y="0" width="24" height="14" rx="7"
                fill={msg.color}
                opacity="0.2"
              >
                <animateMotion
                  dur="2.5s"
                  repeatCount="indefinite"
                  begin={`${msg.delay}s`}
                  path={`M ${msg.from * 33}%,50% L ${msg.to * 33}%,50%`}
                />
              </rect>
            </g>
          ))}
        </svg>

        {/* Simpler approach: animated dots flowing on curved paths */}
        {step >= 1 && (
          <div className="absolute inset-0 pointer-events-none">
            {[0, 1, 2].map((i) => {
              const colors = [AGENTS[0].color, AGENTS[1].color, AGENTS[2].color];
              return (
                <div
                  key={i}
                  className="absolute rounded-full"
                  style={{
                    width: 6,
                    height: 6,
                    backgroundColor: colors[i],
                    opacity: step >= i + 1 ? 0.4 : 0,
                    top: '40%',
                    left: `${20 + i * 25}%`,
                    animation: step >= i + 1 ? `onb-float 2s ease-in-out ${i * 0.4}s infinite` : 'none',
                    transition: 'opacity 0.5s ease',
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Text */}
      <div className="text-center">
        <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.1]">
          <span className="text-zinc-900" style={{ animation: 'onb-fade 0.8s cubic-bezier(0.16,1,0.3,1) both' }}>
            They collaborate
          </span>
          <br />
          <span className="text-zinc-300" style={{ animation: 'onb-fade 0.8s cubic-bezier(0.16,1,0.3,1) 0.15s both' }}>
            in real time.
          </span>
        </h2>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Scene 3 — Share
   Abstract document shapes flow between agents
   ═══════════════════════════════════════════════ */

function SceneShare() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 200);
    const t2 = setTimeout(() => setStep(2), 600);
    const t3 = setTimeout(() => setStep(3), 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // Documents as minimal rectangles floating between agent clusters
  const docs = [
    { x: -60, y: -40, w: 32, h: 40, color: AGENTS[0].color, delay: 0 },
    { x: 10, y: -55, w: 28, h: 36, color: AGENTS[1].color, delay: 0.3 },
    { x: 50, y: -30, w: 34, h: 42, color: AGENTS[2].color, delay: 0.6 },
    { x: -30, y: 10, w: 26, h: 34, color: AGENTS[0].color, delay: 0.9 },
    { x: 40, y: 15, w: 30, h: 38, color: AGENTS[1].color, delay: 1.2 },
  ];

  return (
    <div className="flex flex-col items-center justify-center gap-12 px-8">
      {/* Visual: floating document shapes with agent icons */}
      <div className="relative" style={{ width: 300, height: 200 }}>
        {/* Document shapes */}
        {docs.map((doc, i) => (
          <div
            key={i}
            className="absolute rounded-lg border"
            style={{
              left: `calc(50% + ${doc.x}px)`,
              top: `calc(50% + ${doc.y}px)`,
              width: doc.w,
              height: doc.h,
              borderColor: `${doc.color}25`,
              backgroundColor: `${doc.color}08`,
              opacity: step >= 1 ? 1 : 0,
              transform: step >= 1 ? 'scale(1) rotate(0deg)' : 'scale(0.5) rotate(-10deg)',
              transition: 'all 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
              transitionDelay: `${doc.delay}s`,
              animation: step >= 1 ? `onb-drift-${i % 3} ${12 + i * 2}s ease-in-out infinite` : 'none',
            }}
          >
            {/* Mini lines to suggest text content */}
            <div className="p-1.5 space-y-1">
              <div className="h-[2px] rounded-full" style={{ backgroundColor: `${doc.color}20`, width: '80%' }} />
              <div className="h-[2px] rounded-full" style={{ backgroundColor: `${doc.color}15`, width: '60%' }} />
              <div className="h-[2px] rounded-full" style={{ backgroundColor: `${doc.color}10`, width: '70%' }} />
            </div>
          </div>
        ))}

        {/* Small agent icons scattered among documents */}
        {AGENTS.map((agent, i) => {
          const positions = [
            { x: -80, y: 0 },
            { x: 0, y: 30 },
            { x: 80, y: -10 },
          ];
          return (
            <div
              key={agent.name}
              className="absolute"
              style={{
                left: `calc(50% + ${positions[i].x}px)`,
                top: `calc(50% + ${positions[i].y}px)`,
                transform: 'translate(-50%, -50%)',
                opacity: step >= 2 ? 1 : 0,
                transition: 'opacity 0.8s ease',
                transitionDelay: `${i * 0.15}s`,
                animation: step >= 2 ? `onb-drift-${i} ${16 + i * 2}s ease-in-out infinite` : 'none',
              }}
            >
              <div className="size-10 sm:size-12 flex items-center justify-center">
                <AgentIcon name={agent.name} size={48} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Text */}
      <div className="text-center">
        <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.1]">
          <span className="text-zinc-900" style={{ animation: 'onb-fade 0.8s cubic-bezier(0.16,1,0.3,1) both' }}>
            They share everything.
          </span>
          <br />
          <span className="text-zinc-300" style={{ animation: 'onb-fade 0.8s cubic-bezier(0.16,1,0.3,1) 0.15s both' }}>
            Files. Browser. Knowledge.
          </span>
        </h2>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Scene 4 — Automate
   Orbital motion — agents circle a center point
   ═══════════════════════════════════════════════ */

function SceneAutomate() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setActive(true), 300);
    return () => clearTimeout(t);
  }, []);

  const orbitRadius = 80;

  return (
    <div className="flex flex-col items-center justify-center gap-12 px-8">
      {/* Orbital visual */}
      <div className="relative" style={{ width: orbitRadius * 2 + 120, height: orbitRadius * 2 + 120 }}>
        {/* Orbit ring */}
        <div
          className="absolute rounded-full border border-zinc-100"
          style={{
            left: '50%',
            top: '50%',
            width: orbitRadius * 2,
            height: orbitRadius * 2,
            transform: 'translate(-50%, -50%)',
            opacity: active ? 1 : 0,
            transition: 'opacity 0.8s ease',
          }}
        />

        {/* Center pulse */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ opacity: active ? 1 : 0, transition: 'opacity 0.8s ease' }}
        >
          <div
            className="size-4 rounded-full bg-zinc-200"
            style={{ animation: active ? 'onb-pulse 2.5s ease-in-out infinite' : 'none' }}
          />
        </div>

        {/* Orbiting agents */}
        {AGENTS.map((agent, i) => {
          const startAngle = (i / 3) * 360;
          return (
            <div
              key={agent.name}
              className="absolute left-1/2 top-1/2"
              style={{
                width: 0,
                height: 0,
                opacity: active ? 1 : 0,
                transition: 'opacity 0.8s ease',
                transitionDelay: `${i * 0.15}s`,
                animation: active ? `onb-orbit ${8 + i * 0.5}s linear infinite` : 'none',
                animationDelay: `${(i / 3) * -(8 + i * 0.5)}s`,
              }}
            >
              <div
                className="flex flex-col items-center gap-1.5"
                style={{
                  transform: `translate(-50%, -50%) translateY(-${orbitRadius}px)`,
                }}
              >
                <div
                  className="size-14 sm:size-16 flex items-center justify-center"
                  style={{
                    animation: active ? `onb-orbit ${8 + i * 0.5}s linear infinite reverse` : 'none',
                    animationDelay: `${(i / 3) * -(8 + i * 0.5)}s`,
                  }}
                >
                  <AgentIcon name={agent.name} size={64} />
                </div>
              </div>
            </div>
          );
        })}

        {/* Subtle trail dots on the orbit */}
        {active && Array.from({ length: 12 }).map((_, i) => {
          const angle = (i / 12) * Math.PI * 2;
          return (
            <div
              key={i}
              className="absolute rounded-full bg-zinc-200"
              style={{
                width: 3,
                height: 3,
                left: `calc(50% + ${Math.cos(angle) * orbitRadius}px)`,
                top: `calc(50% + ${Math.sin(angle) * orbitRadius}px)`,
                transform: 'translate(-50%, -50%)',
                opacity: 0.3 + 0.3 * Math.sin(angle * 2),
              }}
            />
          );
        })}
      </div>

      {/* Text */}
      <div className="text-center">
        <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.1]">
          <span className="text-zinc-900" style={{ animation: 'onb-fade 0.8s cubic-bezier(0.16,1,0.3,1) both' }}>
            They work on their own.
          </span>
          <br />
          <span className="text-zinc-300" style={{ animation: 'onb-fade 0.8s cubic-bezier(0.16,1,0.3,1) 0.15s both' }}>
            Routines. Schedules. Autopilot.
          </span>
        </h2>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Scene 5 — Reveal
   Agents converge, tagline appears
   ═══════════════════════════════════════════════ */

function SceneReveal() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 200);
    const t2 = setTimeout(() => setStep(2), 800);
    const t3 = setTimeout(() => setStep(3), 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-10 sm:gap-14 px-8">
      {/* Agents converge from spread positions */}
      <div className="flex items-center">
        {AGENTS.map((agent, i) => {
          const spreadX = (i - 1) * 120;
          return (
            <div
              key={agent.name}
              className="flex items-center justify-center"
              style={{
                opacity: step >= 1 ? 1 : 0,
                transform: step >= 1 ? 'translateX(0) scale(1)' : `translateX(${spreadX * 0.3}px) scale(0.6)`,
                transition: 'all 1.2s cubic-bezier(0.16, 1, 0.3, 1)',
                transitionDelay: `${i * 80}ms`,
                margin: '0 8px',
              }}
            >
              <div className="size-16 sm:size-20 flex items-center justify-center">
                <AgentIcon name={agent.name} size={80} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Tagline */}
      <div className="text-center">
        <h2
          className="text-4xl sm:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1.1]"
          style={{
            opacity: step >= 2 ? 1 : 0,
            transform: step >= 2 ? 'translateY(0)' : 'translateY(16px)',
            transition: 'all 1s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <span className="text-zinc-900">Your agents.</span>
          <br />
          <span className="text-zinc-300">One workspace.</span>
        </h2>
      </div>

      <p
        className="text-sm sm:text-base text-zinc-400 font-medium"
        style={{
          opacity: step >= 3 ? 1 : 0,
          transition: 'opacity 0.8s ease',
        }}
      >
        Connect your first agent to get started.
      </p>
    </div>
  );
}
