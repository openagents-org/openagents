'use client';

import { useState, useEffect, useCallback } from 'react';
import { AgentIcon } from '@/components/icons/agent-icons';
import { cn } from '@/lib/utils';
import {
  FileText, FileCode, Image, Palette, Globe, CalendarClock,
  CheckCircle2, Clock, MessageSquare, FolderOpen, Zap, RotateCcw,
} from 'lucide-react';

const AGENTS = [
  { name: 'claude', label: 'Claude', role: 'Code' },
  { name: 'cursor', label: 'Cursor', role: 'Design' },
  { name: 'gemini', label: 'Gemini', role: 'Optimize' },
] as const;

const SCENE_LABELS = ['Connect', 'Chat', 'Files', 'Automate', 'Start'];
const SCENE_TIMINGS = [200, 3400, 7200, 10600, 13900];
const TOTAL_DURATION = 17000;
const FADE_MS = 350;

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
      setProgress((p) => Math.min(p + 100 / (TOTAL_DURATION / 80), 100));
    }, 80);
    const done = setTimeout(() => setFinished(true), TOTAL_DURATION + 600);
    return () => { timers.forEach(clearTimeout); clearInterval(interval); clearTimeout(done); };
  }, [key]);

  const handleSkip = useCallback(() => {
    setDismissed(true);
    setTimeout(onComplete, 350);
  }, [onComplete]);

  const handleReplay = useCallback(() => {
    setKey((k) => k + 1);
  }, []);

  return (
    <div className={cn(
      'fixed inset-0 z-[100] flex flex-col bg-white transition-all duration-400 overflow-hidden',
      dismissed && 'opacity-0 scale-[0.97]',
    )}>
      {/* Subtle dot grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.025]"
        style={{
          backgroundImage: 'radial-gradient(circle, #000 0.5px, transparent 0.5px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Scene */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        <div
          className={cn('w-full h-full transition-all', fading ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100')}
          style={{ transitionDuration: `${FADE_MS}ms` }}
        >
          {scene === 0 && <SceneAgentsJoin />}
          {scene === 1 && <SceneChat />}
          {scene === 2 && <SceneFiles />}
          {scene === 3 && <SceneBrowserRoutines />}
          {scene === 4 && <SceneReveal />}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="relative shrink-0 px-6 sm:px-8 pb-6 sm:pb-8 pt-2">
        <div className="max-w-xl mx-auto flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            {SCENE_LABELS.map((label, i) => (
              <div key={label} className="flex items-center gap-1.5">
                <div
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-500',
                    scene === i ? 'w-8 bg-zinc-800' : scene > i ? 'w-2.5 bg-zinc-300' : 'w-2.5 bg-zinc-200',
                  )}
                />
                {scene === i && (
                  <span className="text-[10px] font-medium text-zinc-500 animate-in fade-in duration-300 hidden sm:inline">
                    {label}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex-1 h-[3px] bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-zinc-300 to-zinc-400 rounded-full transition-all ease-linear"
              style={{ width: `${progress}%`, transitionDuration: '80ms' }}
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {finished && (
              <button
                onClick={handleReplay}
                className="text-[13px] text-zinc-400 hover:text-zinc-600 transition-colors font-medium px-2 py-1 rounded-lg hover:bg-zinc-50 flex items-center gap-1 animate-in fade-in duration-300"
              >
                <RotateCcw className="size-3" />
                Replay
              </button>
            )}
            <button
              onClick={handleSkip}
              className="text-[13px] text-zinc-400 hover:text-zinc-600 transition-colors font-medium px-3 py-1 rounded-lg hover:bg-zinc-50"
            >
              {finished ? 'Continue' : 'Skip'}
            </button>
          </div>
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
  const [allDone, setAllDone] = useState(false);

  useEffect(() => {
    const timers = AGENTS.map((_, i) =>
      setTimeout(() => setConnected((prev) => [...prev, i]), 500 + i * 800),
    );
    const celebrationTimer = setTimeout(() => setAllDone(true), 500 + AGENTS.length * 800 + 200);
    return () => { timers.forEach(clearTimeout); clearTimeout(celebrationTimer); };
  }, []);

  const count = connected.length;

  return (
    <SceneLayout>
      <FadeUpGroup>
        <SceneCaption
          text="Connect your favorite agents"
          sub="Bring the tools you already use into one workspace"
        />
      </FadeUpGroup>

      <FadeUpGroup delay={200}>
        <div className="w-full max-w-lg mx-auto">
          <Card>
            <div className={cn(
              'px-6 py-4 border-b border-zinc-100 flex items-center gap-3 transition-colors duration-700',
              allDone && 'bg-emerald-50/50',
            )}>
              <div className={cn(
                'size-9 rounded-xl flex items-center justify-center shadow-md transition-all duration-700',
                allDone
                  ? 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/20'
                  : 'bg-gradient-to-br from-blue-500 to-violet-600 shadow-blue-500/20',
              )}>
                {allDone ? <CheckCircle2 className="size-4 text-white" /> : <Zap className="size-4 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold text-zinc-900">My Workspace</div>
                <div className={cn(
                  'text-[11px] transition-colors duration-500',
                  allDone ? 'text-emerald-600 font-medium' : 'text-zinc-400',
                )}>
                  {count === 0 ? 'Ready for agents' : count === 3 ? 'All agents connected!' : `${count} of 3 agents connected`}
                </div>
              </div>
              <div className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all duration-500 shrink-0',
                count === 3 ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-400',
              )}>
                <span>{count}/3</span>
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
                    {isConnected && (
                      <div className="absolute inset-0 bg-emerald-400/10 animate-[ping_0.6s_ease-out_1] rounded-xl pointer-events-none" />
                    )}
                    {isConnected ? (
                      <>
                        <div className="relative shrink-0 animate-in zoom-in-50 duration-300">
                          <div className="size-11 flex items-center justify-center">
                            <AgentIcon name={agent.name} size={44} />
                          </div>
                          <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-emerald-500 border-2 border-white animate-in zoom-in duration-200" />
                        </div>
                        <div className="flex-1 min-w-0 animate-in slide-in-from-left-3 fade-in duration-400">
                          <div className="text-[15px] font-semibold text-zinc-900 truncate">{agent.label}</div>
                          <div className="text-xs text-emerald-600 font-medium mt-0.5">Online</div>
                        </div>
                        <div className="text-[11px] text-zinc-400 font-medium px-2.5 py-1 rounded-md bg-zinc-100 shrink-0 animate-in fade-in duration-500">
                          {agent.role}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="size-11 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center shrink-0">
                          <div className="size-5 rounded-full border-2 border-dashed border-zinc-200 animate-spin" style={{ animationDuration: '8s' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-zinc-300">Waiting for agent...</div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </FadeUpGroup>
    </SceneLayout>
  );
}

/* ═══════════════════════════════════════════════
   Scene 2 — Multi-agent chat with typing indicators
   ═══════════════════════════════════════════════ */

const CHAT_MESSAGES = [
  { role: 'user' as const, text: 'Build me a landing page for my startup', delay: 200, typingDelay: 0 },
  { role: 'agent' as const, agent: 'claude', text: "I'll scaffold the Next.js app, set up routing, and write the API layer.", delay: 1200, typingDelay: 600 },
  { role: 'agent' as const, agent: 'cursor', text: "I'll design the hero section, pick the color palette, and make it responsive.", delay: 2200, typingDelay: 1700 },
  { role: 'agent' as const, agent: 'gemini', text: "I'll analyze competitors, optimize meta tags, and set up analytics.", delay: 3200, typingDelay: 2700 },
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
      <FadeUpGroup>
        <SceneCaption text="They collaborate in real time" sub="Agents talk to you and to each other — in one shared thread" />
      </FadeUpGroup>

      <FadeUpGroup delay={200}>
        <div className="w-full max-w-2xl mx-auto">
          <Card>
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center gap-3">
              <div className="flex -space-x-2">
                {AGENTS.map((a) => (
                  <div key={a.name} className="size-8 rounded-full ring-2 ring-white flex items-center justify-center overflow-hidden shadow-sm">
                    <AgentIcon name={a.name} size={32} />
                  </div>
                ))}
              </div>
              <div className="ml-1 min-w-0">
                <div className="text-[15px] font-semibold text-zinc-900 truncate">Landing Page Project</div>
                <div className="text-[11px] text-zinc-400">3 agents active</div>
              </div>
              <span className="ml-auto text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 font-semibold flex items-center gap-1 shrink-0">
                <MessageSquare className="size-3" />Group
              </span>
            </div>

            <div className="px-6 py-5 space-y-3">
              {CHAT_MESSAGES.map((msg, i) => {
                if (!visible.includes(i)) return null;
                const isUser = msg.role === 'user';
                return (
                  <div key={i} className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    {!isUser && msg.agent && (
                      <div className="size-8 rounded-full shrink-0 flex items-center justify-center mt-0.5 shadow-sm">
                        <AgentIcon name={msg.agent} size={32} />
                      </div>
                    )}
                    <div className={cn(
                      'rounded-2xl px-4 py-2.5',
                      isUser
                        ? 'ml-auto bg-gradient-to-r from-blue-600 to-blue-500 text-white max-w-[70%] shadow-md shadow-blue-500/15'
                        : 'bg-zinc-50 border border-zinc-100 max-w-[75%]',
                    )}>
                      {!isUser && msg.agent && (
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[11px] font-semibold text-zinc-500 capitalize">{msg.agent}</span>
                          <span className="text-[9px] text-zinc-300">just now</span>
                        </div>
                      )}
                      <div className={cn('text-[13px] leading-relaxed', isUser ? 'text-white' : 'text-zinc-700')}>
                        <TypewriterText text={msg.text} speed={10} />
                      </div>
                    </div>
                    {isUser && (
                      <div className="size-8 rounded-full shrink-0 bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center mt-0.5 shadow-sm">
                        <span className="text-white text-[10px] font-bold">Y</span>
                      </div>
                    )}
                  </div>
                );
              })}

              {typing && (
                <div className="flex gap-3 animate-in fade-in duration-200">
                  <div className="size-8 rounded-full shrink-0 flex items-center justify-center mt-0.5 shadow-sm">
                    <AgentIcon name={typing} size={32} />
                  </div>
                  <div className="rounded-2xl px-4 py-2.5 bg-zinc-50 border border-zinc-100">
                    <div className="text-[11px] font-semibold text-zinc-500 mb-1 capitalize">{typing}</div>
                    <TypingDots />
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </FadeUpGroup>
    </SceneLayout>
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
    <SceneLayout>
      <FadeUpGroup>
        <SceneCaption text="Shared files across all agents" sub="Every agent can read, write, and build on each other's work" />
      </FadeUpGroup>

      <FadeUpGroup delay={200}>
        <div className="w-full max-w-xl mx-auto">
          <Card>
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center gap-3">
              <div className="size-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                <FolderOpen className="size-4 text-amber-500" />
              </div>
              <div className="text-[15px] font-semibold text-zinc-900">Project Files</div>
              <span className="ml-auto text-xs text-zinc-400 font-medium shrink-0">{visible.length} files</span>
            </div>

            <div className="p-2">
              {FILES.map((file, i) => {
                if (!visible.includes(i)) return null;
                const Icon = file.icon;
                return (
                  <div
                    key={file.name}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-lg animate-in slide-in-from-left-3 fade-in duration-300"
                  >
                    <div className={cn('size-8 rounded-lg flex items-center justify-center shrink-0', file.bg)}>
                      <Icon className={cn('size-4', file.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-zinc-900 truncate">{file.name}</div>
                    </div>
                    <div className="text-[11px] text-zinc-300 shrink-0 tabular-nums">{file.size}</div>
                    <div className="flex items-center gap-1.5 shrink-0 pl-3 border-l border-zinc-100">
                      <div className="size-4 rounded-full flex items-center justify-center overflow-hidden">
                        <AgentIcon name={file.agent} size={16} />
                      </div>
                      <span className="text-[11px] text-zinc-400 font-medium capitalize">{file.agent}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </FadeUpGroup>
    </SceneLayout>
  );
}

/* ═══════════════════════════════════════════════
   Scene 4 — Browser & Routines
   ═══════════════════════════════════════════════ */

const ROUTINES = [
  { name: 'Run test suite', schedule: 'Daily at 9:00 AM', agent: 'claude', delay: 400 },
  { name: 'Analyze SEO', schedule: 'Weekly on Monday', agent: 'gemini', delay: 1000 },
  { name: 'Deploy staging', schedule: 'On every push', agent: 'claude', delay: 1600 },
];

function SceneBrowserRoutines() {
  const [browserStep, setBrowserStep] = useState(0);
  const [visibleRoutines, setVisibleRoutines] = useState<number[]>([]);

  useEffect(() => {
    const t1 = setTimeout(() => setBrowserStep(1), 200);
    const t2 = setTimeout(() => setBrowserStep(2), 600);
    const t3 = setTimeout(() => setBrowserStep(3), 1000);
    const timers = ROUTINES.map((r, i) =>
      setTimeout(() => setVisibleRoutines((prev) => [...prev, i]), r.delay),
    );
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); timers.forEach(clearTimeout); };
  }, []);

  return (
    <SceneLayout>
      <FadeUpGroup>
        <SceneCaption text="Shared browser, automated routines" sub="Agents browse the web together and run tasks on a schedule" />
      </FadeUpGroup>

      <FadeUpGroup delay={200}>
        <div className="w-full max-w-3xl mx-auto flex flex-col sm:flex-row gap-4">
          {/* Browser */}
          <div className="flex-[1.3] min-w-0">
            <Card>
              <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center gap-3 bg-zinc-50/80">
                <div className="flex gap-1.5 shrink-0">
                  <span className="size-2.5 rounded-full bg-red-300" />
                  <span className="size-2.5 rounded-full bg-amber-300" />
                  <span className="size-2.5 rounded-full bg-emerald-300" />
                </div>
                <div className="flex-1 min-w-0 mx-3">
                  <div className="bg-white rounded-md px-3 py-1 text-[11px] text-zinc-400 text-center font-mono flex items-center justify-center gap-1.5 border border-zinc-100">
                    <Globe className={cn('size-3 shrink-0 transition-colors duration-500', browserStep >= 1 ? 'text-emerald-500' : 'text-zinc-300')} />
                    <span className="truncate">mysite.com</span>
                    {browserStep >= 1 && browserStep < 3 && (
                      <div className="size-2.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0" />
                    )}
                  </div>
                </div>
              </div>

              {/* Browser loading bar */}
              {browserStep >= 1 && browserStep < 3 && (
                <div className="h-0.5 bg-zinc-100 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{
                      animation: 'loadbar 0.8s ease-in-out forwards',
                    }}
                  />
                </div>
              )}

              <div className="p-4">
                <div className={cn(
                  'rounded-xl bg-gradient-to-br from-violet-50 via-white to-blue-50 border border-zinc-100 p-4 sm:p-5 flex flex-col transition-all duration-500 overflow-hidden',
                  browserStep >= 1 ? 'opacity-100' : 'opacity-0',
                )} style={{ aspectRatio: '4/3' }}>
                  {/* Nav */}
                  <div className={cn(
                    'flex items-center gap-3 mb-4 transition-all duration-500',
                    browserStep >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2',
                  )}>
                    <div className="h-5 px-2.5 rounded-md bg-gradient-to-r from-violet-600 to-purple-600 flex items-center justify-center shrink-0">
                      <span className="text-[7px] text-white font-extrabold tracking-wider">LOGO</span>
                    </div>
                    <div className="flex-1" />
                    <div className="hidden sm:flex gap-3">
                      {['Home', 'About', 'Blog'].map((n) => (
                        <span key={n} className="text-[10px] text-zinc-400 font-medium">{n}</span>
                      ))}
                    </div>
                  </div>
                  {/* Hero */}
                  <div className={cn(
                    'flex-1 flex flex-col items-center justify-center text-center gap-2 transition-all duration-500',
                    browserStep >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3',
                  )} style={{ transitionDelay: '150ms' }}>
                    <div className="text-base sm:text-lg font-bold text-zinc-800">Build Something Amazing</div>
                    <div className="text-[10px] sm:text-xs text-zinc-400 max-w-[200px] leading-relaxed">Your next project starts here.</div>
                    <div className="flex gap-2 mt-2">
                      <div className="px-3 py-1.5 rounded-md bg-violet-600 text-[9px] sm:text-[10px] text-white font-semibold shadow-sm">Get Started</div>
                      <div className="px-3 py-1.5 rounded-md border border-violet-200 text-[9px] sm:text-[10px] text-violet-600 font-semibold">Learn More</div>
                    </div>
                  </div>
                  {/* Cards */}
                  <div className={cn(
                    'flex gap-2 mt-3 transition-all duration-500',
                    browserStep >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
                  )}>
                    {['Features', 'Pricing', 'Docs'].map((t, i) => (
                      <div key={t} className="flex-1 rounded-lg bg-white border border-zinc-100 p-2 shadow-sm">
                        <div className={cn(
                          'h-6 rounded mb-1.5',
                          ['bg-gradient-to-br from-amber-50 to-amber-100', 'bg-gradient-to-br from-blue-50 to-blue-100', 'bg-gradient-to-br from-emerald-50 to-emerald-100'][i],
                        )} />
                        <div className="text-[8px] font-semibold text-zinc-500">{t}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Routines */}
          <div className="flex-[0.7] min-w-0 sm:min-w-[220px]">
            <Card>
              <div className="px-5 py-3 border-b border-zinc-100 flex items-center gap-2.5 bg-zinc-50/80">
                <div className="size-6 rounded-md bg-violet-50 flex items-center justify-center shrink-0">
                  <CalendarClock className="size-3 text-violet-500" />
                </div>
                <span className="text-sm font-semibold text-zinc-900">Routines</span>
                <span className="ml-auto text-[10px] text-zinc-400 shrink-0">{visibleRoutines.length} active</span>
              </div>
              <div className="p-3 space-y-2">
                {ROUTINES.map((routine, i) => {
                  if (!visibleRoutines.includes(i)) return null;
                  return (
                    <div
                      key={routine.name}
                      className="flex items-center gap-3 p-3 rounded-xl bg-zinc-50/80 border border-zinc-100 animate-in slide-in-from-right-3 fade-in duration-400"
                    >
                      <div className="size-8 rounded-lg bg-white border border-zinc-100 shrink-0 flex items-center justify-center shadow-sm">
                        <AgentIcon name={routine.agent} size={24} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-zinc-900 truncate">{routine.name}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Clock className="size-2.5 text-zinc-300 shrink-0" />
                          <span className="text-[10px] text-zinc-400 truncate">{routine.schedule}</span>
                        </div>
                      </div>
                      <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      </FadeUpGroup>
    </SceneLayout>
  );
}

/* ═══════════════════════════════════════════════
   Scene 5 — Reveal
   ═══════════════════════════════════════════════ */

function SceneReveal() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 300);
    const t2 = setTimeout(() => setStep(2), 800);
    const t3 = setTimeout(() => setStep(3), 1300);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8 animate-in fade-in duration-700">
      {/* Agent icons */}
      <div className="flex items-end gap-6 sm:gap-10">
        {AGENTS.map((agent, i) => (
          <div
            key={agent.name}
            className={cn(
              'flex flex-col items-center gap-3 transition-all duration-700',
              step >= 1 ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-90',
            )}
            style={{ transitionDelay: `${i * 150}ms` }}
          >
            <div className="relative group">
              <div className={cn(
                'size-20 sm:size-24 flex items-center justify-center rounded-2xl bg-white border shadow-lg p-2 transition-all duration-1000',
                step >= 2 ? 'border-zinc-200 shadow-xl' : 'border-zinc-100 shadow-lg',
              )}>
                <AgentIcon name={agent.name} size={72} />
              </div>
              <div className={cn(
                'absolute -inset-3 rounded-3xl transition-opacity duration-1000 -z-10',
                step >= 2 ? 'opacity-100' : 'opacity-0',
              )} style={{
                background: [
                  'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)',
                  'radial-gradient(circle, rgba(168,85,247,0.08) 0%, transparent 70%)',
                  'radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)',
                ][i],
              }} />
            </div>
            <div className="text-center">
              <div className="text-sm font-semibold text-zinc-800">{agent.label}</div>
              <div className="text-[11px] text-zinc-400">{agent.role}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Animated connecting dots */}
      <div className={cn(
        'mt-8 sm:mt-10 flex items-center gap-0.5 transition-all duration-700',
        step >= 2 ? 'opacity-100' : 'opacity-0',
      )}>
        {Array.from({ length: 28 }).map((_, i) => (
          <div
            key={i}
            className="rounded-full transition-all"
            style={{
              width: step >= 2 ? 4 : 2,
              height: step >= 2 ? 4 : 2,
              backgroundColor: `hsl(${220 + (i / 27) * 120}, 60%, ${65 + 15 * Math.sin((i / 27) * Math.PI)}%)`,
              opacity: 0.3 + 0.7 * Math.sin((i / 27) * Math.PI),
              transitionDelay: `${i * 25}ms`,
              transitionDuration: '600ms',
            }}
          />
        ))}
      </div>

      {/* Tagline */}
      <div className={cn(
        'mt-8 sm:mt-10 text-center transition-all duration-700',
        step >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5',
      )}>
        <h2
          className="text-3xl sm:text-5xl font-bold tracking-tight"
          style={{
            background: 'linear-gradient(135deg, #18181b 0%, #3f3f46 50%, #18181b 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Your agents. One workspace.
        </h2>
      </div>

      <div className={cn(
        'mt-4 text-center transition-all duration-700',
        step >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3',
      )}>
        <p className="text-base sm:text-lg text-zinc-400">Connect your first agent to get started.</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Shared components
   ═══════════════════════════════════════════════ */

function SceneLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-6 sm:px-12 gap-8 sm:gap-10 animate-in fade-in duration-500">
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white shadow-[0_4px_24px_-4px_rgba(0,0,0,0.06)] overflow-hidden">
      {children}
    </div>
  );
}

function SceneCaption({ text, sub }: { text: string; sub: string }) {
  return (
    <div className="text-center max-w-md mx-auto">
      <h3 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 leading-tight">
        {text}
      </h3>
      <p className="mt-2.5 text-sm sm:text-base text-zinc-400 leading-relaxed">
        {sub}
      </p>
    </div>
  );
}

function FadeUpGroup({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <div
      className="animate-in fade-in slide-in-from-bottom-4 duration-700 w-full"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      {children}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 h-5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="size-1.5 rounded-full bg-zinc-400 animate-bounce"
          style={{ animationDelay: `${i * 150}ms`, animationDuration: '0.8s' }}
        />
      ))}
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
        <span className="inline-block w-[2px] h-[0.9em] bg-current opacity-40 animate-pulse ml-px align-baseline rounded-full" />
      )}
    </>
  );
}
