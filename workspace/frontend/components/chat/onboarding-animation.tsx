'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AgentIcon } from '@/components/icons/agent-icons';
import { cn } from '@/lib/utils';
import {
  FileText, FileCode, Image, Palette, Globe, CalendarClock,
  CheckCircle2, Clock, MessageSquare, FolderOpen, Zap, RotateCcw,
} from 'lucide-react';

/* ═══════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════ */

const AGENTS = [
  { name: 'claude', label: 'Claude', role: 'Code & Reasoning', accent: '#6366f1' },
  { name: 'cursor', label: 'Cursor', role: 'Design & Frontend', accent: '#8b5cf6' },
  { name: 'gemini', label: 'Gemini', role: 'Research & Analysis', accent: '#10b981' },
] as const;

const SCENE_TIMINGS = [100, 3200, 6400, 9600, 12400];
const TOTAL_DURATION = 14800;
const FADE_MS = 400;

/* ═══════════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════════ */

export function OnboardingAnimation({ onComplete }: { onComplete: () => void }) {
  const [scene, setScene] = useState(-1);
  const [fading, setFading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [key, setKey] = useState(0);

  useEffect(() => {
    setScene(-1);
    setFading(false);
    setProgress(0);
    setDismissed(false);
    setFinished(false);

    const timers = SCENE_TIMINGS.map((t, i) => {
      if (i === 0) return setTimeout(() => setScene(0), t);
      return setTimeout(() => {
        setFading(true);
        setTimeout(() => { setScene(i); setFading(false); }, FADE_MS);
      }, t);
    });
    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + 100 / (TOTAL_DURATION / 60), 100));
    }, 60);
    const done = setTimeout(() => setFinished(true), TOTAL_DURATION + 500);
    return () => { timers.forEach(clearTimeout); clearInterval(interval); clearTimeout(done); };
  }, [key]);

  const handleSkip = useCallback(() => {
    setDismissed(true);
    setTimeout(onComplete, 400);
  }, [onComplete]);

  const handleReplay = useCallback(() => setKey((k) => k + 1), []);

  return (
    <div className={cn(
      'fixed inset-0 z-[100] flex flex-col overflow-hidden transition-all',
      dismissed ? 'opacity-0 scale-[0.96]' : 'opacity-100 scale-100',
    )} style={{ transitionDuration: '500ms', transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)' }}>

      {/* Ambient background */}
      <AmbientBackground scene={scene} />

      {/* Scene content */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        <div
          className={cn('w-full h-full transition-all')}
          style={{
            opacity: fading ? 0 : 1,
            transform: fading ? 'scale(0.97) translateY(8px)' : 'scale(1) translateY(0)',
            transitionDuration: `${FADE_MS}ms`,
            transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {scene === 0 && <SceneAgentsJoin />}
          {scene === 1 && <SceneChat />}
          {scene === 2 && <SceneFiles />}
          {scene === 3 && <SceneBrowserRoutines />}
          {scene === 4 && <SceneReveal />}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="relative shrink-0 px-6 sm:px-8 pb-6 sm:pb-8 pt-3">
        <div className="max-w-lg mx-auto flex items-center gap-4">
          {/* Scene dots */}
          <div className="flex items-center gap-2">
            {SCENE_TIMINGS.map((_, i) => (
              <div
                key={i}
                className="rounded-full transition-all"
                style={{
                  width: scene === i ? 24 : 6,
                  height: 6,
                  backgroundColor: scene >= i ? '#18181b' : '#e4e4e7',
                  transitionDuration: '500ms',
                  transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                }}
              />
            ))}
          </div>

          {/* Progress */}
          <div className="flex-1 h-1 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${progress}%`,
                background: 'linear-gradient(90deg, #a1a1aa, #52525b)',
                transitionDuration: '60ms',
                transitionTimingFunction: 'linear',
              }}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            {finished && (
              <button
                onClick={handleReplay}
                className="text-[12px] text-zinc-400 hover:text-zinc-700 transition-colors font-medium px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 flex items-center gap-1.5"
                style={{ animation: 'springIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}
              >
                <RotateCcw className="size-3" />
                Replay
              </button>
            )}
            <button
              onClick={handleSkip}
              className="text-[12px] text-zinc-400 hover:text-zinc-700 transition-colors font-medium px-3 py-1.5 rounded-lg hover:bg-zinc-100"
            >
              {finished ? 'Get Started →' : 'Skip'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Ambient background — floating orbs + gradient
   ═══════════════════════════════════════════════ */

function AmbientBackground({ scene }: { scene: number }) {
  const orbs = useMemo(() => Array.from({ length: 5 }, (_, i) => ({
    id: i,
    x: 15 + i * 18,
    y: 20 + (i % 3) * 25,
    size: 200 + i * 80,
    hue: [230, 260, 170, 200, 280][i],
  })), []);

  const bgGradient = [
    'radial-gradient(ellipse at 30% 20%, rgba(99,102,241,0.04) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(139,92,246,0.03) 0%, transparent 60%)',
    'radial-gradient(ellipse at 60% 30%, rgba(59,130,246,0.04) 0%, transparent 60%), radial-gradient(ellipse at 30% 70%, rgba(99,102,241,0.03) 0%, transparent 60%)',
    'radial-gradient(ellipse at 40% 50%, rgba(245,158,11,0.03) 0%, transparent 60%), radial-gradient(ellipse at 70% 30%, rgba(59,130,246,0.03) 0%, transparent 60%)',
    'radial-gradient(ellipse at 50% 40%, rgba(139,92,246,0.04) 0%, transparent 60%), radial-gradient(ellipse at 20% 70%, rgba(16,185,129,0.03) 0%, transparent 60%)',
    'radial-gradient(ellipse at 50% 50%, rgba(99,102,241,0.05) 0%, transparent 50%), radial-gradient(ellipse at 50% 50%, rgba(16,185,129,0.03) 0%, transparent 70%)',
  ][Math.max(0, scene)] || '';

  return (
    <div className="absolute inset-0 bg-white">
      {/* Gradient layer */}
      <div
        className="absolute inset-0 transition-all"
        style={{ background: bgGradient, transitionDuration: '1.5s' }}
      />

      {/* Floating orbs */}
      {orbs.map((orb) => (
        <div
          key={orb.id}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `${orb.x}%`,
            top: `${orb.y}%`,
            width: orb.size,
            height: orb.size,
            background: `radial-gradient(circle, hsla(${orb.hue}, 70%, 70%, 0.06) 0%, transparent 70%)`,
            animation: `orbFloat${orb.id} ${18 + orb.id * 4}s ease-in-out infinite`,
            filter: 'blur(40px)',
          }}
        />
      ))}

      {/* Inline keyframes for orbs */}
      <style>{`
        @keyframes orbFloat0 { 0%,100% { transform: translate(0,0); } 33% { transform: translate(30px,-20px); } 66% { transform: translate(-15px,25px); } }
        @keyframes orbFloat1 { 0%,100% { transform: translate(0,0); } 33% { transform: translate(-25px,15px); } 66% { transform: translate(20px,-30px); } }
        @keyframes orbFloat2 { 0%,100% { transform: translate(0,0); } 33% { transform: translate(15px,30px); } 66% { transform: translate(-25px,-10px); } }
        @keyframes orbFloat3 { 0%,100% { transform: translate(0,0); } 33% { transform: translate(-20px,-25px); } 66% { transform: translate(30px,15px); } }
        @keyframes orbFloat4 { 0%,100% { transform: translate(0,0); } 33% { transform: translate(25px,20px); } 66% { transform: translate(-10px,-30px); } }
        @keyframes springIn { 0% { opacity:0; transform: scale(0.5); } 100% { opacity:1; transform: scale(1); } }
        @keyframes particleBurst { 0% { opacity:1; transform: translate(0,0) scale(1); } 100% { opacity:0; transform: translate(var(--px),var(--py)) scale(0); } }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Scene 1 — Agents connect with particle effects
   ═══════════════════════════════════════════════ */

function SceneAgentsJoin() {
  const [connected, setConnected] = useState<number[]>([]);
  const [particles, setParticles] = useState<{ id: number; agentIdx: number; angle: number }[]>([]);

  useEffect(() => {
    const timers = AGENTS.map((_, i) =>
      setTimeout(() => {
        setConnected((prev) => [...prev, i]);
        const burst = Array.from({ length: 8 }, (_, j) => ({
          id: i * 10 + j,
          agentIdx: i,
          angle: (j / 8) * 360,
        }));
        setParticles((prev) => [...prev, ...burst]);
      }, 400 + i * 900),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const allDone = connected.length === 3;

  return (
    <SceneLayout>
      <SpringIn delay={0}>
        <SceneCaption
          text="Connect your favorite agents"
          sub="Bring Claude, Cursor, Gemini — or any agent you use — into one workspace"
        />
      </SpringIn>

      <SpringIn delay={150}>
        <div className="w-full max-w-lg mx-auto">
          <GlassCard highlight={allDone ? 'emerald' : undefined}>
            <div className={cn(
              'px-6 py-4 border-b transition-colors duration-700',
              allDone ? 'border-emerald-100 bg-emerald-50/30' : 'border-zinc-100',
            )}>
              <div className="flex items-center gap-3">
                <div
                  className="size-10 rounded-xl flex items-center justify-center shadow-lg"
                  style={{
                    background: allDone
                      ? 'linear-gradient(135deg, #10b981, #059669)'
                      : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    transition: 'background 0.7s',
                  }}
                >
                  {allDone
                    ? <CheckCircle2 className="size-5 text-white" style={{ animation: 'springIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both' }} />
                    : <Zap className="size-5 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-semibold text-zinc-900">My Workspace</div>
                  <div className={cn('text-[11px] transition-colors duration-500', allDone ? 'text-emerald-600 font-medium' : 'text-zinc-400')}>
                    {connected.length === 0 ? 'Waiting for agents…' : allDone ? 'All agents ready!' : `${connected.length} of 3 connected`}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 space-y-2.5">
              {AGENTS.map((agent, i) => {
                const isConnected = connected.includes(i);
                return (
                  <div key={agent.name} className="relative">
                    {/* Particle burst */}
                    {particles.filter((p) => p.agentIdx === i).map((p) => {
                      const rad = (p.angle * Math.PI) / 180;
                      const dist = 40 + (p.id % 3) * 15;
                      return (
                        <div
                          key={p.id}
                          className="absolute left-8 top-1/2 size-1.5 rounded-full pointer-events-none"
                          style={{
                            backgroundColor: agent.accent,
                            '--px': `${Math.cos(rad) * dist}px`,
                            '--py': `${Math.sin(rad) * dist}px`,
                            animation: 'particleBurst 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
                          } as React.CSSProperties}
                        />
                      );
                    })}

                    <div
                      className={cn(
                        'flex items-center gap-4 px-5 py-4 rounded-xl transition-all overflow-hidden',
                        isConnected ? 'border bg-gradient-to-r' : 'border border-dashed border-zinc-200',
                      )}
                      style={{
                        borderColor: isConnected ? `${agent.accent}30` : undefined,
                        backgroundImage: isConnected ? `linear-gradient(to right, ${agent.accent}08, ${agent.accent}04)` : undefined,
                        transitionDuration: '600ms',
                        transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                        transform: isConnected ? 'scale(1)' : 'scale(0.98)',
                      }}
                    >
                      {isConnected ? (
                        <>
                          <div className="relative shrink-0" style={{ animation: 'springIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both' }}>
                            <div className="size-11 flex items-center justify-center">
                              <AgentIcon name={agent.name} size={44} />
                            </div>
                            <span
                              className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-emerald-500 border-2 border-white"
                              style={{ animation: 'springIn 0.3s cubic-bezier(0.34,1.56,0.64,1) 0.2s both' }}
                            />
                          </div>
                          <div className="flex-1 min-w-0" style={{ animation: 'springIn 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.1s both' }}>
                            <div className="text-[15px] font-semibold text-zinc-900 truncate">{agent.label}</div>
                            <div className="text-[11px] font-medium mt-0.5" style={{ color: agent.accent }}>{agent.role}</div>
                          </div>
                          <div className="size-5 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${agent.accent}15` }}>
                            <CheckCircle2 className="size-3.5" style={{ color: agent.accent }} />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="size-11 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center shrink-0">
                            <div className="size-5 rounded-full border-2 border-dashed border-zinc-200 animate-spin" style={{ animationDuration: '6s' }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-zinc-300 font-medium">Waiting…</div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        </div>
      </SpringIn>
    </SceneLayout>
  );
}

/* ═══════════════════════════════════════════════
   Scene 2 — Multi-agent chat
   ═══════════════════════════════════════════════ */

const CHAT_MESSAGES = [
  { role: 'user' as const, text: 'Set up a marketing site for our new product launch', delay: 150, typingDelay: 0 },
  { role: 'agent' as const, agent: 'claude', text: "On it — scaffolding Next.js with auth, payments API, and deployment config.", delay: 1100, typingDelay: 500 },
  { role: 'agent' as const, agent: 'cursor', text: "Designing the hero and pricing page. I'll pull the brand tokens from your shared files.", delay: 2100, typingDelay: 1600 },
  { role: 'agent' as const, agent: 'gemini', text: "Running competitor analysis. I'll optimize meta tags and set up conversion tracking.", delay: 3000, typingDelay: 2500 },
];

function SceneChat() {
  const [visible, setVisible] = useState<number[]>([]);
  const [typing, setTyping] = useState<string | null>(null);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    CHAT_MESSAGES.forEach((msg, i) => {
      if (msg.role === 'agent' && msg.agent) {
        timers.push(setTimeout(() => setTyping(msg.agent!), msg.typingDelay));
      }
      timers.push(setTimeout(() => {
        setTyping(null);
        setVisible((prev) => [...prev, i]);
      }, msg.delay));
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <SceneLayout>
      <SpringIn>
        <SceneCaption text="They collaborate in real time" sub="Multiple agents work your request simultaneously, each contributing their expertise" />
      </SpringIn>

      <SpringIn delay={150}>
        <div className="w-full max-w-2xl mx-auto">
          <GlassCard>
            <div className="px-6 py-3.5 border-b border-zinc-100 flex items-center gap-3">
              <div className="flex -space-x-2.5">
                {AGENTS.map((a) => (
                  <div key={a.name} className="size-7 rounded-full ring-2 ring-white flex items-center justify-center overflow-hidden">
                    <AgentIcon name={a.name} size={28} />
                  </div>
                ))}
              </div>
              <div className="ml-1 min-w-0">
                <div className="text-sm font-semibold text-zinc-900 truncate">Product Launch</div>
              </div>
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-semibold shrink-0">
                3 active
              </span>
            </div>

            <div className="px-5 py-4 space-y-3">
              {CHAT_MESSAGES.map((msg, i) => {
                if (!visible.includes(i)) return null;
                const isUser = msg.role === 'user';
                const agent = !isUser ? AGENTS.find((a) => a.name === msg.agent) : null;
                return (
                  <div
                    key={i}
                    className="flex gap-2.5"
                    style={{ animation: 'springIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}
                  >
                    {!isUser && (
                      <div className="size-7 rounded-full shrink-0 flex items-center justify-center mt-0.5">
                        <AgentIcon name={msg.agent!} size={28} />
                      </div>
                    )}
                    <div className={cn(
                      'rounded-2xl px-3.5 py-2.5',
                      isUser
                        ? 'ml-auto bg-zinc-900 text-white max-w-[72%]'
                        : 'max-w-[78%]',
                    )} style={!isUser ? { backgroundColor: `${agent?.accent}08`, border: `1px solid ${agent?.accent}15` } : undefined}>
                      {!isUser && agent && (
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[11px] font-semibold" style={{ color: agent.accent }}>{agent.label}</span>
                          <span className="text-[9px] text-zinc-300">just now</span>
                        </div>
                      )}
                      <div className={cn('text-[13px] leading-relaxed', isUser ? 'text-white/90' : 'text-zinc-700')}>
                        <TypewriterText text={msg.text} speed={8} />
                      </div>
                    </div>
                    {isUser && (
                      <div className="size-7 rounded-full shrink-0 bg-zinc-900 flex items-center justify-center mt-0.5">
                        <span className="text-white text-[10px] font-bold">Y</span>
                      </div>
                    )}
                  </div>
                );
              })}

              {typing && (
                <div className="flex gap-2.5" style={{ animation: 'springIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both' }}>
                  <div className="size-7 rounded-full shrink-0 flex items-center justify-center mt-0.5">
                    <AgentIcon name={typing} size={28} />
                  </div>
                  <div className="rounded-2xl px-3.5 py-2.5" style={{
                    backgroundColor: `${AGENTS.find((a) => a.name === typing)?.accent}08`,
                    border: `1px solid ${AGENTS.find((a) => a.name === typing)?.accent}15`,
                  }}>
                    <TypingDots color={AGENTS.find((a) => a.name === typing)?.accent} />
                  </div>
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      </SpringIn>
    </SceneLayout>
  );
}

/* ═══════════════════════════════════════════════
   Scene 3 — Shared file system
   ═══════════════════════════════════════════════ */

const FILES = [
  { name: 'app/page.tsx', icon: FileCode, color: '#6366f1', agent: 'claude', size: '2.4 KB', delay: 150 },
  { name: 'components/Hero.tsx', icon: FileCode, color: '#8b5cf6', agent: 'cursor', size: '5.1 KB', delay: 400 },
  { name: 'api/payments.ts', icon: FileText, color: '#6366f1', agent: 'claude', size: '1.8 KB', delay: 650 },
  { name: 'styles/theme.css', icon: Palette, color: '#ec4899', agent: 'cursor', size: '3.2 KB', delay: 900 },
  { name: 'public/logo.svg', icon: Image, color: '#f59e0b', agent: 'cursor', size: '890 B', delay: 1150 },
  { name: 'seo-config.json', icon: FileText, color: '#10b981', agent: 'gemini', size: '1.1 KB', delay: 1400 },
];

function SceneFiles() {
  const [visible, setVisible] = useState<number[]>([]);

  useEffect(() => {
    const timers = FILES.map((f, i) =>
      setTimeout(() => setVisible((prev) => [...prev, i]), f.delay),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <SceneLayout>
      <SpringIn>
        <SceneCaption text="Shared files across all agents" sub="Every agent reads, writes, and builds on each other's work — no copy-pasting between tools" />
      </SpringIn>

      <SpringIn delay={150}>
        <div className="w-full max-w-xl mx-auto">
          <GlassCard>
            <div className="px-6 py-3.5 border-b border-zinc-100 flex items-center gap-3">
              <div className="size-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                <FolderOpen className="size-4 text-amber-500" />
              </div>
              <div className="text-sm font-semibold text-zinc-900">Project Files</div>
              <div className="ml-auto flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] text-zinc-400 tabular-nums">{visible.length} files</span>
              </div>
            </div>

            <div className="p-2.5 space-y-0.5">
              {FILES.map((file, i) => {
                if (!visible.includes(i)) return null;
                const Icon = file.icon;
                const agent = AGENTS.find((a) => a.name === file.agent);
                return (
                  <div
                    key={file.name}
                    className="flex items-center gap-3 px-3.5 py-2 rounded-lg hover:bg-zinc-50/80 transition-colors"
                    style={{
                      animation: 'springIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both',
                      animationDelay: '0ms',
                    }}
                  >
                    <div className="size-7 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `${file.color}10` }}>
                      <Icon className="size-3.5" style={{ color: file.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-zinc-800 truncate font-mono">{file.name}</div>
                    </div>
                    <div className="text-[10px] text-zinc-300 shrink-0 tabular-nums font-mono">{file.size}</div>
                    <div className="flex items-center gap-1.5 shrink-0 pl-2.5 border-l border-zinc-100">
                      <div className="size-4 rounded-full flex items-center justify-center overflow-hidden">
                        <AgentIcon name={file.agent} size={16} />
                      </div>
                      <span className="text-[10px] font-medium" style={{ color: agent?.accent }}>{agent?.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        </div>
      </SpringIn>
    </SceneLayout>
  );
}

/* ═══════════════════════════════════════════════
   Scene 4 — Browser & Routines
   ═══════════════════════════════════════════════ */

const ROUTINES = [
  { name: 'Run test suite', schedule: 'Every day, 9 AM', agent: 'claude', delay: 300 },
  { name: 'SEO audit', schedule: 'Mondays', agent: 'gemini', delay: 800 },
  { name: 'Deploy to staging', schedule: 'On push', agent: 'claude', delay: 1300 },
];

function SceneBrowserRoutines() {
  const [browserStep, setBrowserStep] = useState(0);
  const [visibleRoutines, setVisibleRoutines] = useState<number[]>([]);

  useEffect(() => {
    const t1 = setTimeout(() => setBrowserStep(1), 150);
    const t2 = setTimeout(() => setBrowserStep(2), 500);
    const t3 = setTimeout(() => setBrowserStep(3), 900);
    const timers = ROUTINES.map((r, i) =>
      setTimeout(() => setVisibleRoutines((prev) => [...prev, i]), r.delay),
    );
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); timers.forEach(clearTimeout); };
  }, []);

  return (
    <SceneLayout>
      <SpringIn>
        <SceneCaption text="Shared browser & automated routines" sub="Agents browse the web together and run recurring tasks on your behalf" />
      </SpringIn>

      <SpringIn delay={150}>
        <div className="w-full max-w-3xl mx-auto flex flex-col sm:flex-row gap-4">
          {/* Browser */}
          <div className="flex-[1.3] min-w-0">
            <GlassCard>
              <div className="px-4 py-2 border-b border-zinc-100 flex items-center gap-3">
                <div className="flex gap-1.5 shrink-0">
                  <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="size-2.5 rounded-full bg-[#febc2e]" />
                  <span className="size-2.5 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex-1 min-w-0 mx-2">
                  <div className="bg-zinc-50 rounded-md px-3 py-1 text-[11px] text-zinc-400 text-center font-mono flex items-center justify-center gap-1.5 border border-zinc-100">
                    <Globe className={cn('size-3 shrink-0 transition-colors', browserStep >= 1 ? 'text-emerald-500' : 'text-zinc-300')} style={{ transitionDuration: '500ms' }} />
                    <span className="truncate">acme-launch.com</span>
                  </div>
                </div>
              </div>

              {browserStep >= 1 && browserStep < 3 && (
                <div className="h-0.5 bg-zinc-100 overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ animation: 'loadbar 0.8s ease-in-out forwards' }} />
                </div>
              )}

              <div className="p-3.5">
                <div
                  className="rounded-xl border border-zinc-100 p-4 flex flex-col overflow-hidden transition-opacity"
                  style={{
                    aspectRatio: '4/3',
                    background: 'linear-gradient(135deg, #faf5ff 0%, #ffffff 40%, #eff6ff 100%)',
                    opacity: browserStep >= 1 ? 1 : 0,
                    transitionDuration: '500ms',
                  }}
                >
                  <div
                    className="flex items-center gap-3 mb-3 transition-all"
                    style={{
                      opacity: browserStep >= 2 ? 1 : 0,
                      transform: browserStep >= 2 ? 'translateY(0)' : 'translateY(-8px)',
                      transitionDuration: '500ms',
                      transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  >
                    <div className="h-5 px-2.5 rounded-md bg-gradient-to-r from-violet-600 to-indigo-600 flex items-center justify-center shrink-0">
                      <span className="text-[7px] text-white font-extrabold tracking-widest">ACME</span>
                    </div>
                    <div className="flex-1" />
                    <div className="hidden sm:flex gap-3">
                      {['Product', 'Pricing', 'Docs'].map((n) => (
                        <span key={n} className="text-[9px] text-zinc-400 font-medium">{n}</span>
                      ))}
                    </div>
                  </div>

                  <div
                    className="flex-1 flex flex-col items-center justify-center text-center gap-2 transition-all"
                    style={{
                      opacity: browserStep >= 2 ? 1 : 0,
                      transform: browserStep >= 2 ? 'translateY(0)' : 'translateY(12px)',
                      transitionDuration: '600ms',
                      transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                      transitionDelay: '100ms',
                    }}
                  >
                    <div className="text-sm sm:text-base font-bold text-zinc-800">Ship faster with AI agents</div>
                    <div className="text-[9px] sm:text-[10px] text-zinc-400 max-w-[180px]">Your team of AI agents, working 24/7.</div>
                    <div className="flex gap-2 mt-1.5">
                      <div className="px-2.5 py-1 rounded-md bg-violet-600 text-[8px] sm:text-[9px] text-white font-semibold">Start Free</div>
                      <div className="px-2.5 py-1 rounded-md border border-violet-200 text-[8px] sm:text-[9px] text-violet-600 font-semibold">Watch Demo</div>
                    </div>
                  </div>

                  <div
                    className="flex gap-2 mt-2 transition-all"
                    style={{
                      opacity: browserStep >= 3 ? 1 : 0,
                      transform: browserStep >= 3 ? 'translateY(0)' : 'translateY(8px)',
                      transitionDuration: '500ms',
                      transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  >
                    {[
                      { t: 'Features', bg: 'from-violet-50 to-violet-100' },
                      { t: 'Pricing', bg: 'from-blue-50 to-blue-100' },
                      { t: 'Docs', bg: 'from-emerald-50 to-emerald-100' },
                    ].map((card) => (
                      <div key={card.t} className="flex-1 rounded-lg bg-white border border-zinc-100 p-1.5 shadow-sm">
                        <div className={cn('h-5 rounded mb-1 bg-gradient-to-br', card.bg)} />
                        <div className="text-[7px] font-semibold text-zinc-500">{card.t}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Routines */}
          <div className="flex-[0.7] min-w-0 sm:min-w-[200px]">
            <GlassCard>
              <div className="px-5 py-3 border-b border-zinc-100 flex items-center gap-2.5">
                <div className="size-6 rounded-md bg-violet-50 flex items-center justify-center shrink-0">
                  <CalendarClock className="size-3 text-violet-500" />
                </div>
                <span className="text-sm font-semibold text-zinc-900">Routines</span>
              </div>
              <div className="p-3 space-y-2">
                {ROUTINES.map((routine, i) => {
                  if (!visibleRoutines.includes(i)) return null;
                  const agent = AGENTS.find((a) => a.name === routine.agent);
                  return (
                    <div
                      key={routine.name}
                      className="flex items-center gap-2.5 p-2.5 rounded-xl border border-zinc-100 bg-zinc-50/50"
                      style={{ animation: 'springIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both' }}
                    >
                      <div className="size-7 rounded-lg bg-white border border-zinc-100 shrink-0 flex items-center justify-center">
                        <AgentIcon name={routine.agent} size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold text-zinc-800 truncate">{routine.name}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Clock className="size-2.5 text-zinc-300 shrink-0" />
                          <span className="text-[9px] text-zinc-400 truncate">{routine.schedule}</span>
                        </div>
                      </div>
                      <CheckCircle2 className="size-3.5 shrink-0" style={{ color: agent?.accent }} />
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </div>
        </div>
      </SpringIn>
    </SceneLayout>
  );
}

/* ═══════════════════════════════════════════════
   Scene 5 — Dramatic reveal
   ═══════════════════════════════════════════════ */

function SceneReveal() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 200);
    const t2 = setTimeout(() => setStep(2), 700);
    const t3 = setTimeout(() => setStep(3), 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8">
      {/* Agent icons — converge from spread positions */}
      <div className="relative flex items-end gap-5 sm:gap-8">
        {AGENTS.map((agent, i) => {
          const startX = (i - 1) * 60;
          return (
            <div
              key={agent.name}
              className="flex flex-col items-center gap-3"
              style={{
                opacity: step >= 1 ? 1 : 0,
                transform: step >= 1
                  ? 'translateX(0) translateY(0) scale(1)'
                  : `translateX(${startX}px) translateY(30px) scale(0.7)`,
                transitionDuration: '800ms',
                transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                transitionDelay: `${i * 100}ms`,
                transitionProperty: 'all',
              }}
            >
              <div className="relative">
                <div
                  className="size-20 sm:size-[88px] flex items-center justify-center rounded-2xl bg-white border border-zinc-200 p-2"
                  style={{
                    boxShadow: step >= 2
                      ? `0 8px 32px -4px ${agent.accent}20, 0 4px 16px -2px rgba(0,0,0,0.06)`
                      : '0 4px 16px -2px rgba(0,0,0,0.06)',
                    transition: 'box-shadow 1s',
                  }}
                >
                  <AgentIcon name={agent.name} size={64} />
                </div>
                {/* Glow */}
                <div
                  className="absolute -inset-4 rounded-3xl -z-10"
                  style={{
                    background: `radial-gradient(circle, ${agent.accent}12 0%, transparent 70%)`,
                    opacity: step >= 2 ? 1 : 0,
                    transition: 'opacity 1s',
                  }}
                />
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold text-zinc-800">{agent.label}</div>
                <div className="text-[10px] text-zinc-400">{agent.role}</div>
              </div>
            </div>
          );
        })}

        {/* Connecting lines between agents */}
        <svg
          className="absolute top-10 sm:top-11 left-0 right-0 -z-10 pointer-events-none"
          style={{
            opacity: step >= 2 ? 0.3 : 0,
            transition: 'opacity 0.8s',
          }}
          viewBox="0 0 300 4"
          preserveAspectRatio="none"
        >
          <line x1="30" y1="2" x2="270" y2="2" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="4 3" />
          <defs>
            <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={AGENTS[0].accent} />
              <stop offset="50%" stopColor={AGENTS[1].accent} />
              <stop offset="100%" stopColor={AGENTS[2].accent} />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Tagline */}
      <div
        className="mt-10 sm:mt-12 text-center"
        style={{
          opacity: step >= 2 ? 1 : 0,
          transform: step >= 2 ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.95)',
          transitionDuration: '700ms',
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
          transitionDelay: '100ms',
          transitionProperty: 'all',
        }}
      >
        <h2
          className="text-3xl sm:text-5xl font-bold tracking-tight"
          style={{
            background: 'linear-gradient(135deg, #18181b 0%, #6366f1 50%, #18181b 100%)',
            backgroundSize: '200% auto',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            animation: step >= 2 ? 'gradientShift 3s ease-in-out infinite' : 'none',
          }}
        >
          Your agents. One workspace.
        </h2>
      </div>

      <div
        className="mt-3 text-center"
        style={{
          opacity: step >= 3 ? 1 : 0,
          transform: step >= 3 ? 'translateY(0)' : 'translateY(10px)',
          transitionDuration: '600ms',
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
          transitionProperty: 'all',
        }}
      >
        <p className="text-sm sm:text-base text-zinc-400">Connect your first agent to get started</p>
      </div>

      <style>{`
        @keyframes gradientShift {
          0%, 100% { background-position: 0% center; }
          50% { background-position: 100% center; }
        }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Shared components
   ═══════════════════════════════════════════════ */

function SceneLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-6 sm:px-12 gap-7 sm:gap-9">
      {children}
    </div>
  );
}

function GlassCard({ children, highlight }: { children: React.ReactNode; highlight?: string }) {
  return (
    <div
      className="rounded-2xl border bg-white/80 backdrop-blur-sm overflow-hidden"
      style={{
        borderColor: highlight ? `var(--color-${highlight}-200)` : 'rgba(228,228,231,0.8)',
        boxShadow: '0 4px 32px -8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      {children}
    </div>
  );
}

function SceneCaption({ text, sub }: { text: string; sub: string }) {
  return (
    <div className="text-center max-w-lg mx-auto">
      <h3 className="text-2xl sm:text-[28px] font-bold tracking-tight text-zinc-900 leading-tight">
        {text}
      </h3>
      <p className="mt-2 text-[13px] sm:text-sm text-zinc-400 leading-relaxed max-w-md mx-auto">
        {sub}
      </p>
    </div>
  );
}

function SpringIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <div
      className="w-full"
      style={{
        animation: 'springIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        animationDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

function TypingDots({ color = '#a1a1aa' }: { color?: string }) {
  return (
    <div className="flex items-center gap-1 h-5 px-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="size-1.5 rounded-full"
          style={{
            backgroundColor: color,
            opacity: 0.6,
            animation: `bounce 0.8s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}

function TypewriterText({ text, speed = 16 }: { text: string; speed?: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount((c) => {
        if (c >= text.length) { clearInterval(interval); return c; }
        return c + 1;
      });
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return (
    <>
      {text.slice(0, count)}
      {count < text.length && (
        <span
          className="inline-block w-[2px] h-[0.85em] rounded-full ml-px align-baseline"
          style={{ backgroundColor: 'currentColor', opacity: 0.3, animation: 'pulse 1s ease-in-out infinite' }}
        />
      )}
    </>
  );
}
