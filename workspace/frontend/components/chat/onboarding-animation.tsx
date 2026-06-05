'use client';

import { useState, useEffect, useCallback } from 'react';
import { AgentIcon } from '@/components/icons/agent-icons';
import { cn } from '@/lib/utils';
import {
  FileText, FileCode, Image, Palette, Globe, CalendarClock,
  CheckCircle2, Clock, MessageSquare, FolderOpen,
} from 'lucide-react';

const AGENTS = [
  { name: 'claude', label: 'Claude' },
  { name: 'cursor', label: 'Cursor' },
  { name: 'gemini', label: 'Gemini' },
] as const;

const TOTAL_DURATION = 15500;

export function OnboardingAnimation({ onComplete }: { onComplete: () => void }) {
  const [scene, setScene] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timers = [
      setTimeout(() => setScene(0), 200),
      setTimeout(() => setScene(1), 3200),
      setTimeout(() => setScene(2), 6400),
      setTimeout(() => setScene(3), 9800),
      setTimeout(() => setScene(4), 13000),
    ];
    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + 100 / (TOTAL_DURATION / 100), 100));
    }, 100);
    const done = setTimeout(onComplete, TOTAL_DURATION + 500);
    return () => { timers.forEach(clearTimeout); clearInterval(interval); clearTimeout(done); };
  }, [onComplete]);

  const handleSkip = useCallback(() => {
    setDismissed(true);
    setTimeout(onComplete, 300);
  }, [onComplete]);

  return (
    <div className={cn(
      'fixed inset-0 z-[100] flex flex-col bg-white transition-all duration-500 overflow-hidden',
      dismissed && 'opacity-0 scale-95',
    )}>
      {/* Scene container */}
      <div className="flex-1 flex items-center justify-center">
        {scene === 0 && <SceneAgentsJoin />}
        {scene === 1 && <SceneChat />}
        {scene === 2 && <SceneFiles />}
        {scene === 3 && <SceneBrowserRoutines />}
        {scene === 4 && <SceneReveal />}
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 px-8 pb-8 pt-2">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <div className="flex gap-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-500',
                  scene === i ? 'w-8 bg-zinc-900' : scene > i ? 'w-2 bg-zinc-400' : 'w-2 bg-zinc-200',
                )}
              />
            ))}
          </div>
          <div className="flex-1 h-1 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-zinc-300 rounded-full transition-all duration-100 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
          <button
            onClick={handleSkip}
            className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors font-medium"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Scene 1: Agents connect ─── */

function SceneAgentsJoin() {
  const [connected, setConnected] = useState<number[]>([]);

  useEffect(() => {
    const timers = AGENTS.map((_, i) =>
      setTimeout(() => setConnected((prev) => [...prev, i]), 600 + i * 750),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8 animate-in fade-in duration-700">
      <SceneCaption text="Connect your favorite agents" sub="Bring Claude, Cursor, Gemini — or any agent you already use" />

      <div className="mt-12 w-full max-w-xl">
        <div className="rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center gap-3">
            <div className="size-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">W</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-900">My Workspace</div>
              <div className="text-[11px] text-zinc-400">3 agent slots</div>
            </div>
          </div>

          <div className="p-5 space-y-2">
            {AGENTS.map((agent, i) => {
              const isConnected = connected.includes(i);
              return (
                <div
                  key={agent.name}
                  className={cn(
                    'flex items-center gap-4 px-5 py-4 rounded-xl transition-all duration-500',
                    isConnected
                      ? 'bg-emerald-50 border border-emerald-200'
                      : 'border border-dashed border-zinc-200 bg-zinc-50/50',
                  )}
                >
                  {isConnected ? (
                    <>
                      <div className="relative animate-in zoom-in-50 duration-400">
                        <div className="size-12 flex items-center justify-center">
                          <AgentIcon name={agent.name} size={48} />
                        </div>
                        <span className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-emerald-500 border-[3px] border-white animate-in zoom-in duration-300" />
                      </div>
                      <div className="flex-1 animate-in slide-in-from-left-3 fade-in duration-400">
                        <div className="text-base font-semibold text-zinc-900">{agent.label}</div>
                        <div className="text-xs text-emerald-600 font-medium mt-0.5">Connected and ready</div>
                      </div>
                      <CheckCircle2 className="size-5 text-emerald-500 animate-in zoom-in duration-300" />
                    </>
                  ) : (
                    <>
                      <div className="size-12 rounded-xl bg-zinc-100 flex items-center justify-center">
                        <div className="size-5 rounded-full border-2 border-dashed border-zinc-300" />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm text-zinc-400">Waiting for agent...</div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Scene 2: Multi-agent chat ─── */

const CHAT_MESSAGES = [
  { role: 'user' as const, text: 'Build me a landing page for my startup', delay: 300 },
  { role: 'agent' as const, agent: 'claude', text: "On it. I'll scaffold the Next.js app, set up the routing, and write the API layer.", delay: 1000 },
  { role: 'agent' as const, agent: 'cursor', text: "I'll handle the visual design — hero section, typography, color palette, and responsive layout.", delay: 2000 },
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
    <div className="w-full h-full flex flex-col items-center justify-center px-8 animate-in fade-in duration-700">
      <SceneCaption text="They collaborate in real time" sub="Agents talk, delegate tasks, and build together" />

      <div className="mt-12 w-full max-w-2xl">
        <div className="rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center gap-3">
            <div className="flex -space-x-2">
              {AGENTS.slice(0, 2).map((a) => (
                <div key={a.name} className="size-8 rounded-full ring-2 ring-white flex items-center justify-center overflow-hidden">
                  <AgentIcon name={a.name} size={32} />
                </div>
              ))}
            </div>
            <div className="ml-1">
              <div className="text-sm font-semibold text-zinc-900">Landing Page Project</div>
              <div className="text-[11px] text-zinc-400">2 agents active</div>
            </div>
            <span className="ml-auto text-[10px] px-2 py-1 rounded-full bg-blue-50 text-blue-600 font-medium">
              <MessageSquare className="size-3 inline mr-1" />Group
            </span>
          </div>

          <div className="p-6 space-y-5 min-h-[280px]">
            {CHAT_MESSAGES.map((msg, i) => {
              if (!visible.includes(i)) return null;
              const isUser = msg.role === 'user';
              return (
                <div
                  key={i}
                  className={cn(
                    'flex gap-3 animate-in fade-in duration-400',
                    isUser ? 'slide-in-from-right-4' : 'slide-in-from-left-4',
                  )}
                >
                  {!isUser && msg.agent && (
                    <div className="size-10 rounded-full shrink-0 flex items-center justify-center mt-1">
                      <AgentIcon name={msg.agent} size={40} />
                    </div>
                  )}
                  <div className={cn(
                    'rounded-2xl px-5 py-3.5',
                    isUser
                      ? 'ml-auto bg-blue-600 text-white max-w-[75%]'
                      : 'bg-zinc-100 max-w-[80%]',
                  )}>
                    {!isUser && msg.agent && (
                      <div className="text-[11px] font-semibold text-zinc-400 mb-1 capitalize">{msg.agent}</div>
                    )}
                    <TypewriterText text={msg.text} className={cn('text-[15px] leading-relaxed', isUser ? 'text-white' : 'text-zinc-700')} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Scene 3: Shared file system ─── */

const FILES = [
  { name: 'index.tsx', icon: FileCode, color: 'text-blue-500', agent: 'claude', size: '2.4 KB', delay: 300 },
  { name: 'hero.tsx', icon: FileCode, color: 'text-violet-500', agent: 'cursor', size: '5.1 KB', delay: 650 },
  { name: 'api/routes.ts', icon: FileText, color: 'text-emerald-500', agent: 'claude', size: '1.8 KB', delay: 1000 },
  { name: 'globals.css', icon: Palette, color: 'text-pink-500', agent: 'cursor', size: '3.2 KB', delay: 1350 },
  { name: 'logo.svg', icon: Image, color: 'text-amber-500', agent: 'cursor', size: '890 B', delay: 1700 },
  { name: 'seo-config.json', icon: FileText, color: 'text-cyan-500', agent: 'gemini', size: '1.1 KB', delay: 2050 },
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
    <div className="w-full h-full flex flex-col items-center justify-center px-8 animate-in fade-in duration-700">
      <SceneCaption text="Shared files across all agents" sub="Every agent can read, write, and build on each other's work" />

      <div className="mt-12 w-full max-w-2xl">
        <div className="rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center gap-3">
            <FolderOpen className="size-5 text-zinc-400" />
            <div className="text-sm font-semibold text-zinc-900">Project Files</div>
            <span className="ml-auto text-xs text-zinc-400">{visible.length} files</span>
          </div>

          <div className="p-4 space-y-1.5 min-h-[340px]">
            {FILES.map((file, i) => {
              if (!visible.includes(i)) return null;
              const Icon = file.icon;
              return (
                <div
                  key={file.name}
                  className="flex items-center gap-4 px-5 py-3.5 rounded-xl bg-zinc-50 border border-zinc-100 animate-in slide-in-from-bottom-3 fade-in duration-300"
                >
                  <Icon className={cn('size-6 shrink-0', file.color)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-900 truncate">{file.name}</div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">{file.size}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="size-5 rounded-full flex items-center justify-center overflow-hidden">
                      <AgentIcon name={file.agent} size={20} />
                    </div>
                    <span className="text-[11px] text-zinc-400 capitalize">{file.agent}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Scene 4: Browser & Routines ─── */

const ROUTINES = [
  { name: 'Run test suite', schedule: 'Daily at 9:00 AM', agent: 'claude', delay: 500 },
  { name: 'Analyze SEO performance', schedule: 'Weekly on Monday', agent: 'gemini', delay: 1100 },
  { name: 'Deploy to staging', schedule: 'On every push', agent: 'claude', delay: 1700 },
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
    <div className="w-full h-full flex flex-col items-center justify-center px-8 animate-in fade-in duration-700">
      <SceneCaption text="Shared browser, automated routines" sub="Agents browse the web and run tasks on a schedule" />

      <div className="mt-12 w-full max-w-4xl flex gap-4">
        {/* Browser */}
        <div className="flex-[1.4] rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2.5 bg-zinc-50">
            <div className="flex gap-1.5">
              <span className="size-3 rounded-full bg-red-400" />
              <span className="size-3 rounded-full bg-yellow-400" />
              <span className="size-3 rounded-full bg-green-400" />
            </div>
            <div className="flex-1 mx-4">
              <div className="bg-white rounded-lg px-3 py-1.5 text-xs text-zinc-400 text-center font-mono flex items-center justify-center gap-2 border border-zinc-100">
                <Globe className={cn('size-3 transition-colors duration-500', browserLoaded ? 'text-blue-500' : 'text-zinc-300')} />
                mysite.com
              </div>
            </div>
          </div>

          <div className={cn(
            'h-[300px] p-4 transition-all duration-700',
            browserLoaded ? 'opacity-100' : 'opacity-0',
          )}>
            <div className="h-full rounded-xl bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-100 p-5 flex flex-col">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-14 h-4 rounded bg-gradient-to-r from-violet-500 to-purple-600">
                  <span className="text-[8px] text-white font-bold flex items-center justify-center h-full">LOGO</span>
                </div>
                <div className="flex-1" />
                {['Home', 'About', 'Blog', 'Contact'].map((n) => (
                  <span key={n} className="text-[10px] text-zinc-400 font-medium">{n}</span>
                ))}
              </div>
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
                <div className="text-xl font-bold text-zinc-800">Build Something Amazing</div>
                <div className="text-xs text-zinc-400 max-w-[220px]">Your next project starts here. Fast, modern, beautiful.</div>
                <div className="flex gap-2 mt-3">
                  <div className="px-4 py-2 rounded-lg bg-violet-600 text-[10px] text-white font-medium">Get Started</div>
                  <div className="px-4 py-2 rounded-lg border border-violet-300 text-[10px] text-violet-600 font-medium">Learn More</div>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                {['Features', 'Pricing', 'Docs'].map((t, i) => (
                  <div key={t} className="flex-1 rounded-lg bg-white/70 border border-zinc-200/50 p-2.5">
                    <div className={cn(
                      'h-8 rounded mb-2',
                      ['bg-amber-100', 'bg-blue-100', 'bg-emerald-100'][i],
                    )} />
                    <div className="text-[9px] font-semibold text-zinc-500">{t}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Routines */}
        <div className="flex-[0.6] rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center gap-2.5 bg-zinc-50">
            <CalendarClock className="size-4 text-violet-500" />
            <span className="text-sm font-semibold text-zinc-900">Routines</span>
          </div>
          <div className="p-4 space-y-3 min-h-[300px]">
            {ROUTINES.map((routine, i) => {
              if (!visibleRoutines.includes(i)) return null;
              return (
                <div
                  key={routine.name}
                  className="flex items-start gap-3 p-4 rounded-xl bg-zinc-50 border border-zinc-100 animate-in slide-in-from-right-4 fade-in duration-400"
                >
                  <div className="size-8 rounded-full shrink-0 flex items-center justify-center mt-0.5">
                    <AgentIcon name={routine.agent} size={32} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-zinc-900">{routine.name}</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Clock className="size-3 text-zinc-400" />
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
    </div>
  );
}

/* ─── Scene 5: Reveal ─── */

function SceneReveal() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 400);
    const t2 = setTimeout(() => setStep(2), 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8 animate-in fade-in duration-700">
      <div className="flex items-center gap-12">
        {AGENTS.map((agent, i) => (
          <div
            key={agent.name}
            className={cn(
              'flex flex-col items-center gap-3 transition-all duration-600',
              step >= 0 ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-6 scale-90',
            )}
            style={{ transitionDelay: `${i * 150}ms` }}
          >
            <div className="size-20 sm:size-24 flex items-center justify-center">
              <AgentIcon name={agent.name} size={96} />
            </div>
            <span className="text-sm font-medium text-zinc-500">{agent.label}</span>
          </div>
        ))}
      </div>

      <div className={cn(
        'mt-10 w-48 h-px transition-all duration-1000',
        step >= 1 ? 'bg-gradient-to-r from-transparent via-zinc-300 to-transparent opacity-100' : 'opacity-0',
      )} />

      <div className={cn(
        'mt-10 text-center transition-all duration-700',
        step >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
      )}>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900">Your agents. One workspace.</h2>
      </div>

      <div className={cn(
        'mt-4 text-center transition-all duration-700',
        step >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3',
      )}>
        <p className="text-base text-zinc-400">Connect your first agent to get started.</p>
      </div>
    </div>
  );
}

/* ─── Shared ─── */

function SceneCaption({ text, sub }: { text: string; sub: string }) {
  return (
    <div className="text-center">
      <h3 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 animate-in fade-in slide-in-from-bottom-3 duration-500">
        {text}
      </h3>
      <p className="mt-2 text-sm sm:text-base text-zinc-400 animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: '150ms', animationFillMode: 'both' }}>
        {sub}
      </p>
    </div>
  );
}

function TypewriterText({ text, className }: { text: string; className?: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount((c) => {
        if (c >= text.length) { clearInterval(interval); return c; }
        return c + 1;
      });
    }, 16);
    return () => clearInterval(interval);
  }, [text]);

  return (
    <span className={className}>
      {text.slice(0, count)}
      {count < text.length && <span className="inline-block w-0.5 h-4 bg-current opacity-60 animate-pulse ml-px align-middle" />}
    </span>
  );
}
