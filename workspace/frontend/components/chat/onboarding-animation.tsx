'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AgentIcon } from '@/components/icons/agent-icons';
import { cn } from '@/lib/utils';
import {
  FileText, FileCode, Image, Palette, Globe, CalendarClock,
  CheckCircle2, Clock, MessageSquare, FolderOpen, Zap,
} from 'lucide-react';

const AGENTS = [
  { name: 'claude', label: 'Claude', role: 'Code' },
  { name: 'cursor', label: 'Cursor', role: 'Design' },
  { name: 'gemini', label: 'Gemini', role: 'Optimize' },
] as const;

const SCENE_TIMINGS = [200, 3400, 6600, 10000, 13200];
const TOTAL_DURATION = 16000;
const FADE_MS = 400;

export function OnboardingAnimation({ onComplete }: { onComplete: () => void }) {
  const [scene, setScene] = useState(-1);
  const [fading, setFading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const sceneRef = useRef(-1);

  useEffect(() => {
    const timers = SCENE_TIMINGS.map((t, i) => {
      if (i === 0) return setTimeout(() => { sceneRef.current = 0; setScene(0); }, t);
      return setTimeout(() => {
        setFading(true);
        setTimeout(() => {
          sceneRef.current = i;
          setScene(i);
          setFading(false);
        }, FADE_MS);
      }, t);
    });
    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + 100 / (TOTAL_DURATION / 80), 100));
    }, 80);
    const done = setTimeout(onComplete, TOTAL_DURATION + 600);
    return () => { timers.forEach(clearTimeout); clearInterval(interval); clearTimeout(done); };
  }, [onComplete]);

  const handleSkip = useCallback(() => {
    setDismissed(true);
    setTimeout(onComplete, 350);
  }, [onComplete]);

  return (
    <div className={cn(
      'fixed inset-0 z-[100] flex flex-col bg-white transition-all duration-400 overflow-hidden',
      dismissed && 'opacity-0 scale-[0.97]',
    )}>
      {/* Subtle dot grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, #000 0.5px, transparent 0.5px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Scene container with crossfade */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        <div className={cn(
          'w-full h-full transition-all',
          fading ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100',
        )} style={{ transitionDuration: `${FADE_MS}ms` }}>
          {scene === 0 && <SceneAgentsJoin />}
          {scene === 1 && <SceneChat />}
          {scene === 2 && <SceneFiles />}
          {scene === 3 && <SceneBrowserRoutines />}
          {scene === 4 && <SceneReveal />}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="relative shrink-0 px-8 pb-8 pt-3">
        <div className="max-w-xl mx-auto flex items-center gap-5">
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <button
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-600',
                  scene === i
                    ? 'w-10 bg-zinc-800'
                    : scene > i
                      ? 'w-3 bg-zinc-300'
                      : 'w-3 bg-zinc-200',
                )}
              />
            ))}
          </div>
          <div className="flex-1 h-[3px] bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-zinc-300 to-zinc-400 rounded-full transition-all ease-linear"
              style={{ width: `${progress}%`, transitionDuration: '80ms' }}
            />
          </div>
          <button
            onClick={handleSkip}
            className="text-[13px] text-zinc-400 hover:text-zinc-600 transition-colors font-medium px-3 py-1 rounded-lg hover:bg-zinc-50"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Scene 1 — Agents connect to the workspace
   ═══════════════════════════════════════════════ */

function SceneAgentsJoin() {
  const [connected, setConnected] = useState<number[]>([]);

  useEffect(() => {
    const timers = AGENTS.map((_, i) =>
      setTimeout(() => setConnected((prev) => [...prev, i]), 500 + i * 800),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-6 sm:px-12">
      <FadeUpGroup>
        <SceneCaption
          text="Connect your favorite agents"
          sub="Bring the tools you already use into one workspace"
        />
      </FadeUpGroup>

      <FadeUpGroup delay={200}>
        <div className="mt-10 sm:mt-14 w-full max-w-lg">
          <div className="rounded-2xl border border-zinc-100 bg-white shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center gap-3">
              <div className="size-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-md shadow-blue-500/20">
                <Zap className="size-4 text-white" />
              </div>
              <div>
                <div className="text-[15px] font-semibold text-zinc-900">My Workspace</div>
                <div className="text-[11px] text-zinc-400">Ready for agents</div>
              </div>
            </div>

            <div className="p-4 space-y-2">
              {AGENTS.map((agent, i) => {
                const isConnected = connected.includes(i);
                return (
                  <div
                    key={agent.name}
                    className={cn(
                      'relative flex items-center gap-4 px-5 py-4 rounded-xl transition-all duration-500 overflow-hidden',
                      isConnected
                        ? 'bg-gradient-to-r from-emerald-50 to-teal-50/50 border border-emerald-200/60'
                        : 'border border-dashed border-zinc-200',
                    )}
                  >
                    {/* Connection flash */}
                    {isConnected && (
                      <div className="absolute inset-0 bg-emerald-400/10 animate-[ping_0.6s_ease-out_1] rounded-xl pointer-events-none" />
                    )}
                    {isConnected ? (
                      <>
                        <div className="relative animate-in zoom-in-50 duration-300">
                          <div className="size-12 flex items-center justify-center rounded-xl shadow-sm">
                            <AgentIcon name={agent.name} size={48} />
                          </div>
                          <span className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-emerald-500 border-[3px] border-white animate-in zoom-in duration-200">
                            <CheckCircle2 className="size-2.5 text-white absolute top-[2px] left-[2px]" />
                          </span>
                        </div>
                        <div className="flex-1 min-w-0 animate-in slide-in-from-left-3 fade-in duration-400">
                          <div className="text-[15px] font-semibold text-zinc-900">{agent.label}</div>
                          <div className="text-xs text-emerald-600 font-medium mt-0.5">Online</div>
                        </div>
                        <div className="text-[11px] text-zinc-400 font-medium px-2 py-0.5 rounded-md bg-zinc-100 animate-in fade-in duration-500">
                          {agent.role}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="size-12 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center">
                          <div className="size-5 rounded-full border-2 border-dashed border-zinc-200 animate-spin" style={{ animationDuration: '8s' }} />
                        </div>
                        <div className="flex-1">
                          <div className="text-sm text-zinc-300">Waiting for agent...</div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </FadeUpGroup>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Scene 2 — Multi-agent chat
   ═══════════════════════════════════════════════ */

const CHAT_MESSAGES = [
  { role: 'user' as const, text: 'Build me a landing page for my startup', delay: 200 },
  { role: 'agent' as const, agent: 'claude', text: "I'll scaffold the Next.js app, set up routing, and write the API layer.", delay: 900 },
  { role: 'agent' as const, agent: 'cursor', text: "I'll design the hero section, pick the color palette, and make it responsive.", delay: 1800 },
];

function SceneChat() {
  const [visible, setVisible] = useState<number[]>([]);

  useEffect(() => {
    const timers = CHAT_MESSAGES.map((msg, i) =>
      setTimeout(() => setVisible((prev) => [...prev, i]), msg.delay),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-6 sm:px-12">
      <FadeUpGroup>
        <SceneCaption text="They collaborate in real time" sub="Agents talk to you and to each other — in one shared thread" />
      </FadeUpGroup>

      <FadeUpGroup delay={200}>
        <div className="mt-10 sm:mt-14 w-full max-w-2xl">
          <div className="rounded-2xl border border-zinc-100 bg-white shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center gap-3">
              <div className="flex -space-x-2">
                {AGENTS.slice(0, 2).map((a) => (
                  <div key={a.name} className="size-8 rounded-full ring-2 ring-white flex items-center justify-center overflow-hidden shadow-sm">
                    <AgentIcon name={a.name} size={32} />
                  </div>
                ))}
              </div>
              <div className="ml-1">
                <div className="text-[15px] font-semibold text-zinc-900">Landing Page Project</div>
                <div className="text-[11px] text-zinc-400">2 agents active</div>
              </div>
              <span className="ml-auto text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 font-semibold flex items-center gap-1">
                <MessageSquare className="size-3" />Group
              </span>
            </div>

            {/* Messages */}
            <div className="px-6 py-6 space-y-4 min-h-[240px]">
              {CHAT_MESSAGES.map((msg, i) => {
                if (!visible.includes(i)) return null;
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={i}
                    className={cn(
                      'flex gap-3 animate-in fade-in duration-400',
                      isUser ? 'slide-in-from-bottom-3' : 'slide-in-from-bottom-3',
                    )}
                  >
                    {!isUser && msg.agent && (
                      <div className="size-9 rounded-full shrink-0 flex items-center justify-center mt-0.5 shadow-sm">
                        <AgentIcon name={msg.agent} size={36} />
                      </div>
                    )}
                    <div className={cn(
                      'rounded-2xl px-5 py-3',
                      isUser
                        ? 'ml-auto bg-gradient-to-r from-blue-600 to-blue-500 text-white max-w-[75%] shadow-md shadow-blue-500/15'
                        : 'bg-zinc-50 border border-zinc-100 max-w-[80%]',
                    )}>
                      {!isUser && msg.agent && (
                        <div className="text-[11px] font-semibold text-zinc-400 mb-1 capitalize">{msg.agent}</div>
                      )}
                      <TypewriterText text={msg.text} speed={14} className={cn('text-[15px] leading-relaxed', isUser ? 'text-white' : 'text-zinc-700')} />
                    </div>
                    {isUser && (
                      <div className="size-9 rounded-full shrink-0 bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center mt-0.5 shadow-sm">
                        <span className="text-white text-xs font-bold">Y</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </FadeUpGroup>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Scene 3 — Shared file system
   ═══════════════════════════════════════════════ */

const FILES = [
  { name: 'index.tsx', icon: FileCode, color: 'text-blue-500', bg: 'bg-blue-50', agent: 'claude', size: '2.4 KB', delay: 200 },
  { name: 'hero.tsx', icon: FileCode, color: 'text-violet-500', bg: 'bg-violet-50', agent: 'cursor', size: '5.1 KB', delay: 500 },
  { name: 'api/routes.ts', icon: FileText, color: 'text-emerald-500', bg: 'bg-emerald-50', agent: 'claude', size: '1.8 KB', delay: 800 },
  { name: 'globals.css', icon: Palette, color: 'text-pink-500', bg: 'bg-pink-50', agent: 'cursor', size: '3.2 KB', delay: 1100 },
  { name: 'logo.svg', icon: Image, color: 'text-amber-500', bg: 'bg-amber-50', agent: 'cursor', size: '890 B', delay: 1400 },
  { name: 'seo-config.json', icon: FileText, color: 'text-cyan-500', bg: 'bg-cyan-50', agent: 'gemini', size: '1.1 KB', delay: 1700 },
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
    <div className="w-full h-full flex flex-col items-center justify-center px-6 sm:px-12">
      <FadeUpGroup>
        <SceneCaption text="Shared files across all agents" sub="Every agent can read, write, and build on each other's work" />
      </FadeUpGroup>

      <FadeUpGroup delay={200}>
        <div className="mt-10 sm:mt-14 w-full max-w-2xl">
          <div className="rounded-2xl border border-zinc-100 bg-white shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center gap-3">
              <div className="size-8 rounded-lg bg-amber-50 flex items-center justify-center">
                <FolderOpen className="size-4 text-amber-500" />
              </div>
              <div className="text-[15px] font-semibold text-zinc-900">Project Files</div>
              <span className="ml-auto text-xs text-zinc-400 font-medium">{visible.length} files</span>
            </div>

            <div className="p-3 space-y-1 min-h-[340px]">
              {FILES.map((file, i) => {
                if (!visible.includes(i)) return null;
                const Icon = file.icon;
                return (
                  <div
                    key={file.name}
                    className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-zinc-50 transition-colors animate-in slide-in-from-left-4 fade-in duration-300"
                    style={{ animationDelay: '0ms' }}
                  >
                    <div className={cn('size-9 rounded-lg flex items-center justify-center shrink-0', file.bg)}>
                      <Icon className={cn('size-4', file.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-900 truncate">{file.name}</div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">{file.size}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 px-2 py-1 rounded-lg bg-zinc-50 border border-zinc-100">
                      <div className="size-4 rounded-full flex items-center justify-center overflow-hidden">
                        <AgentIcon name={file.agent} size={16} />
                      </div>
                      <span className="text-[11px] text-zinc-500 font-medium capitalize">{file.agent}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </FadeUpGroup>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Scene 4 — Browser & Routines
   ═══════════════════════════════════════════════ */

const ROUTINES = [
  { name: 'Run test suite', schedule: 'Daily at 9:00 AM', agent: 'claude', icon: '🧪', delay: 400 },
  { name: 'Analyze SEO', schedule: 'Weekly on Monday', agent: 'gemini', icon: '📊', delay: 1000 },
  { name: 'Deploy staging', schedule: 'On every push', agent: 'claude', icon: '🚀', delay: 1600 },
];

function SceneBrowserRoutines() {
  const [browserLoaded, setBrowserLoaded] = useState(false);
  const [visibleRoutines, setVisibleRoutines] = useState<number[]>([]);

  useEffect(() => {
    const t1 = setTimeout(() => setBrowserLoaded(true), 300);
    const timers = ROUTINES.map((r, i) =>
      setTimeout(() => setVisibleRoutines((prev) => [...prev, i]), r.delay),
    );
    return () => { clearTimeout(t1); timers.forEach(clearTimeout); };
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-6 sm:px-12">
      <FadeUpGroup>
        <SceneCaption text="Shared browser, automated routines" sub="Agents browse the web together and run tasks on a schedule" />
      </FadeUpGroup>

      <FadeUpGroup delay={200}>
        <div className="mt-10 sm:mt-14 w-full max-w-4xl flex gap-5">
          {/* Browser */}
          <div className="flex-[1.4] rounded-2xl border border-zinc-100 bg-white shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center gap-3 bg-zinc-50/80">
              <div className="flex gap-1.5">
                <span className="size-3 rounded-full bg-zinc-200 hover:bg-red-400 transition-colors" />
                <span className="size-3 rounded-full bg-zinc-200 hover:bg-yellow-400 transition-colors" />
                <span className="size-3 rounded-full bg-zinc-200 hover:bg-green-400 transition-colors" />
              </div>
              <div className="flex-1 mx-6">
                <div className="bg-white rounded-lg px-4 py-1.5 text-xs text-zinc-400 text-center font-mono flex items-center justify-center gap-2 border border-zinc-100 shadow-sm">
                  <Globe className={cn('size-3.5 transition-colors duration-500', browserLoaded ? 'text-blue-500' : 'text-zinc-300')} />
                  mysite.com
                </div>
              </div>
            </div>

            <div className={cn(
              'h-[320px] p-5 transition-all duration-700',
              browserLoaded ? 'opacity-100' : 'opacity-0',
            )}>
              <div className="h-full rounded-xl bg-gradient-to-br from-violet-50 via-white to-blue-50 border border-zinc-100 p-6 flex flex-col shadow-inner">
                {/* Nav */}
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-16 h-5 rounded-md bg-gradient-to-r from-violet-600 to-purple-600 flex items-center justify-center">
                    <span className="text-[8px] text-white font-extrabold tracking-wider">LOGO</span>
                  </div>
                  <div className="flex-1" />
                  {['Home', 'About', 'Blog', 'Contact'].map((n) => (
                    <span key={n} className="text-[11px] text-zinc-400 font-medium hover:text-zinc-600">{n}</span>
                  ))}
                </div>
                {/* Hero */}
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
                  <div className="text-xl font-bold text-zinc-800">Build Something Amazing</div>
                  <div className="text-xs text-zinc-400 max-w-[240px] leading-relaxed">Your next project starts here. Fast, modern, and beautiful.</div>
                  <div className="flex gap-3 mt-3">
                    <div className="px-4 py-2 rounded-lg bg-violet-600 text-[11px] text-white font-semibold shadow-md shadow-violet-500/20">Get Started</div>
                    <div className="px-4 py-2 rounded-lg border border-violet-200 text-[11px] text-violet-600 font-semibold">Learn More</div>
                  </div>
                </div>
                {/* Cards */}
                <div className="flex gap-3 mt-4">
                  {['Features', 'Pricing', 'Docs'].map((t, i) => (
                    <div key={t} className="flex-1 rounded-lg bg-white border border-zinc-100 p-3 shadow-sm">
                      <div className={cn(
                        'h-8 rounded-md mb-2',
                        ['bg-gradient-to-br from-amber-50 to-amber-100', 'bg-gradient-to-br from-blue-50 to-blue-100', 'bg-gradient-to-br from-emerald-50 to-emerald-100'][i],
                      )} />
                      <div className="text-[10px] font-semibold text-zinc-600">{t}</div>
                      <div className="text-[8px] text-zinc-400 mt-0.5">Learn more</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Routines */}
          <div className="flex-[0.6] rounded-2xl border border-zinc-100 bg-white shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center gap-2.5 bg-zinc-50/80">
              <div className="size-7 rounded-lg bg-violet-50 flex items-center justify-center">
                <CalendarClock className="size-3.5 text-violet-500" />
              </div>
              <span className="text-[15px] font-semibold text-zinc-900">Routines</span>
            </div>
            <div className="p-4 space-y-3 min-h-[320px]">
              {ROUTINES.map((routine, i) => {
                if (!visibleRoutines.includes(i)) return null;
                return (
                  <div
                    key={routine.name}
                    className="flex items-start gap-3 p-4 rounded-xl bg-zinc-50/80 border border-zinc-100 animate-in slide-in-from-right-4 fade-in duration-400"
                  >
                    <div className="size-9 rounded-xl bg-white border border-zinc-100 shrink-0 flex items-center justify-center mt-0.5 shadow-sm">
                      <AgentIcon name={routine.agent} size={28} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{routine.icon}</span>
                        <div className="text-sm font-semibold text-zinc-900">{routine.name}</div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Clock className="size-3 text-zinc-300" />
                        <span className="text-[11px] text-zinc-400">{routine.schedule}</span>
                      </div>
                    </div>
                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-1" />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </FadeUpGroup>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Scene 5 — Reveal
   ═══════════════════════════════════════════════ */

function SceneReveal() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 300);
    const t2 = setTimeout(() => setStep(2), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8">
      {/* Agent icons */}
      <div className="flex items-end gap-8 sm:gap-14">
        {AGENTS.map((agent, i) => (
          <div
            key={agent.name}
            className={cn(
              'flex flex-col items-center gap-3 transition-all duration-700',
              step >= 0 ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-90',
            )}
            style={{ transitionDelay: `${i * 120}ms` }}
          >
            <div className="size-20 sm:size-[88px] flex items-center justify-center rounded-2xl bg-zinc-50 border border-zinc-100 shadow-lg p-2">
              <AgentIcon name={agent.name} size={72} />
            </div>
            <div className="text-center">
              <div className="text-sm font-semibold text-zinc-800">{agent.label}</div>
              <div className="text-[11px] text-zinc-400">{agent.role}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Connecting dots */}
      <div className={cn(
        'mt-10 flex items-center gap-1 transition-all duration-1000',
        step >= 1 ? 'opacity-100' : 'opacity-0',
      )}>
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="size-1 rounded-full bg-zinc-200" style={{ opacity: Math.sin((i / 19) * Math.PI) }} />
        ))}
      </div>

      {/* Tagline */}
      <div className={cn(
        'mt-10 text-center transition-all duration-700',
        step >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5',
      )}>
        <h2 className="text-4xl sm:text-5xl font-bold tracking-tight text-zinc-900">
          Your agents. One workspace.
        </h2>
      </div>

      <div className={cn(
        'mt-5 text-center transition-all duration-700',
        step >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3',
      )}>
        <p className="text-lg text-zinc-400">Connect your first agent to get started.</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Shared components
   ═══════════════════════════════════════════════ */

function SceneCaption({ text, sub }: { text: string; sub: string }) {
  return (
    <div className="text-center max-w-lg mx-auto">
      <h3 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900">
        {text}
      </h3>
      <p className="mt-3 text-base sm:text-lg text-zinc-400 leading-relaxed">
        {sub}
      </p>
    </div>
  );
}

function FadeUpGroup({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <div
      className="animate-in fade-in slide-in-from-bottom-4 duration-700"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      {children}
    </div>
  );
}

function TypewriterText({ text, speed = 16, className }: { text: string; speed?: number; className?: string }) {
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
    <span className={className}>
      {text.slice(0, count)}
      {count < text.length && <span className="inline-block w-[2px] h-[1.1em] bg-current opacity-50 animate-pulse ml-0.5 align-middle rounded-full" />}
    </span>
  );
}
