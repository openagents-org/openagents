'use client';

import { useState, useEffect, useCallback } from 'react';
import { AgentIcon } from '@/components/icons/agent-icons';
import { cn } from '@/lib/utils';
import {
  FileText, FileCode, Image, Palette, Globe, CalendarClock,
  CheckCircle2, Search, BarChart3, Clock,
} from 'lucide-react';

const AGENTS = [
  { name: 'claude', label: 'Claude' },
  { name: 'cursor', label: 'Cursor' },
  { name: 'gemini', label: 'Gemini' },
] as const;

const TOTAL_DURATION = 15000;

export function OnboardingAnimation({ onComplete }: { onComplete: () => void }) {
  const [scene, setScene] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timers = [
      setTimeout(() => setScene(0), 300),
      setTimeout(() => setScene(1), 3000),
      setTimeout(() => setScene(2), 6000),
      setTimeout(() => setScene(3), 9500),
      setTimeout(() => setScene(4), 12500),
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
      'relative flex flex-col h-full w-full bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-zinc-900 transition-all duration-500 overflow-hidden',
      dismissed && 'opacity-0 scale-95',
    )}>
      {/* Scene container */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-8">
        <div className="w-full max-w-3xl">
          {scene === 0 && <SceneAgentsJoin />}
          {scene === 1 && <SceneChat />}
          {scene === 2 && <SceneFiles />}
          {scene === 3 && <SceneBrowserRoutines />}
          {scene === 4 && <SceneReveal />}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 px-6 pb-5 pt-2">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="flex-1 h-1 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-zinc-400 dark:bg-zinc-500 rounded-full transition-all duration-100 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
          <button
            onClick={handleSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Scene 1: Agents connect to the workspace ─── */

function SceneAgentsJoin() {
  const [connected, setConnected] = useState<number[]>([]);

  useEffect(() => {
    const timers = AGENTS.map((_, i) =>
      setTimeout(() => setConnected((prev) => [...prev, i]), 600 + i * 700),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="animate-in fade-in duration-500">
      <SceneCaption text="Connect your favorite agents" />
      <div className="mt-8 flex flex-col items-center">
        {/* Workspace mockup */}
        <div className="w-full max-w-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
          {/* Sidebar header */}
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
            <div className="flex items-center gap-2">
              <div className="size-6 rounded-md bg-gradient-to-br from-blue-500 to-violet-500" />
              <span className="text-sm font-semibold text-foreground">My Workspace</span>
            </div>
          </div>

          {/* Agent slots */}
          <div className="p-3 space-y-1">
            <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Agents
            </div>
            {AGENTS.map((agent, i) => {
              const isConnected = connected.includes(i);
              return (
                <div
                  key={agent.name}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-500',
                    isConnected
                      ? 'bg-emerald-50/80 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30'
                      : 'border border-dashed border-zinc-200 dark:border-zinc-700',
                  )}
                >
                  {isConnected ? (
                    <>
                      <div className="relative animate-in zoom-in-50 duration-300">
                        <div className="size-8 flex items-center justify-center">
                          <AgentIcon name={agent.name} size={32} />
                        </div>
                        <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-emerald-500 border-2 border-white dark:border-zinc-900 animate-in zoom-in duration-300" />
                      </div>
                      <div className="animate-in slide-in-from-left-2 fade-in duration-300">
                        <div className="text-sm font-medium">{agent.label}</div>
                        <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Connected</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="size-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                        <div className="size-4 rounded-full border-2 border-dashed border-zinc-300 dark:border-zinc-600" />
                      </div>
                      <div className="text-xs text-muted-foreground">Waiting for agent...</div>
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
  { role: 'user' as const, text: 'Build me a landing page for my startup', delay: 400 },
  { role: 'agent' as const, agent: 'claude', text: "I'll scaffold the Next.js app and write the API routes.", delay: 1200 },
  { role: 'agent' as const, agent: 'cursor', text: "I'll design the hero section and style all the components.", delay: 2100 },
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
    <div className="animate-in fade-in duration-500">
      <SceneCaption text="They collaborate in real time" />
      <div className="mt-8 flex justify-center">
        <div className="w-full max-w-lg rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
          {/* Chat header */}
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
            <div className="flex -space-x-1.5">
              {AGENTS.slice(0, 2).map((a) => (
                <div key={a.name} className="size-6 rounded-full ring-2 ring-white dark:ring-zinc-900 flex items-center justify-center overflow-hidden">
                  <AgentIcon name={a.name} size={24} />
                </div>
              ))}
            </div>
            <span className="text-sm font-medium ml-1">Landing Page Project</span>
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium">Group</span>
          </div>

          {/* Messages */}
          <div className="p-4 space-y-3 min-h-[180px]">
            {CHAT_MESSAGES.map((msg, i) => {
              if (!visible.includes(i)) return null;
              const isUser = msg.role === 'user';
              return (
                <div
                  key={i}
                  className={cn(
                    'flex gap-2.5 animate-in fade-in duration-300',
                    isUser ? 'slide-in-from-right-3' : 'slide-in-from-left-3',
                  )}
                >
                  {!isUser && msg.agent && (
                    <div className="size-7 rounded-full shrink-0 flex items-center justify-center mt-0.5">
                      <AgentIcon name={msg.agent} size={28} />
                    </div>
                  )}
                  <div className={cn(
                    'rounded-xl px-3.5 py-2.5 max-w-[80%]',
                    isUser
                      ? 'ml-auto bg-blue-600 text-white'
                      : 'bg-zinc-100 dark:bg-zinc-800',
                  )}>
                    {!isUser && msg.agent && (
                      <div className="text-[10px] font-semibold text-muted-foreground mb-0.5 capitalize">{msg.agent}</div>
                    )}
                    <TypewriterText text={msg.text} className={cn('text-sm', isUser && 'text-white')} />
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
  { name: 'index.tsx', icon: FileCode, color: 'text-blue-500', agent: 'claude', delay: 300 },
  { name: 'hero.tsx', icon: FileCode, color: 'text-violet-500', agent: 'cursor', delay: 700 },
  { name: 'api/routes.ts', icon: FileText, color: 'text-emerald-500', agent: 'claude', delay: 1100 },
  { name: 'styles.css', icon: Palette, color: 'text-pink-500', agent: 'cursor', delay: 1500 },
  { name: 'logo.svg', icon: Image, color: 'text-amber-500', agent: 'cursor', delay: 1900 },
  { name: 'seo-config.json', icon: FileText, color: 'text-blue-400', agent: 'gemini', delay: 2300 },
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
    <div className="animate-in fade-in duration-500">
      <SceneCaption text="Shared files — every agent can read and write" />
      <div className="mt-8 flex justify-center">
        <div className="w-full max-w-lg rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
          {/* File header */}
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Files</span>
            <span className="ml-auto text-xs text-muted-foreground">{visible.length} files</span>
          </div>

          {/* File grid */}
          <div className="p-4 grid grid-cols-3 gap-3 min-h-[200px]">
            {FILES.map((file, i) => {
              if (!visible.includes(i)) return null;
              const Icon = file.icon;
              return (
                <div
                  key={file.name}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 animate-in zoom-in-75 fade-in duration-300"
                >
                  <div className="relative">
                    <Icon className={cn('size-8', file.color)} />
                    <div className="absolute -bottom-1 -right-1.5 size-4 rounded-full ring-2 ring-white dark:ring-zinc-900 flex items-center justify-center overflow-hidden">
                      <AgentIcon name={file.agent} size={16} />
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-center truncate w-full">{file.name}</span>
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
  { name: 'Run tests', schedule: 'Daily at 9:00 AM', agent: 'claude', delay: 600 },
  { name: 'Check SEO score', schedule: 'Weekly on Monday', agent: 'gemini', delay: 1200 },
  { name: 'Deploy to staging', schedule: 'On every push', agent: 'claude', delay: 1800 },
];

function SceneBrowserRoutines() {
  const [browserLoaded, setBrowserLoaded] = useState(false);
  const [visibleRoutines, setVisibleRoutines] = useState<number[]>([]);

  useEffect(() => {
    const t1 = setTimeout(() => setBrowserLoaded(true), 400);
    const timers = ROUTINES.map((r, i) =>
      setTimeout(() => setVisibleRoutines((prev) => [...prev, i]), r.delay),
    );
    return () => { clearTimeout(t1); timers.forEach(clearTimeout); };
  }, []);

  return (
    <div className="animate-in fade-in duration-500">
      <SceneCaption text="Shared browser, automated routines" />
      <div className="mt-8 flex justify-center">
        <div className="flex gap-3 w-full max-w-2xl">
          {/* Browser card */}
          <div className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50">
              <Globe className={cn('size-3.5 transition-colors duration-500', browserLoaded ? 'text-blue-500' : 'text-zinc-400')} />
              <div className="flex-1 bg-white dark:bg-zinc-700 rounded px-2 py-0.5 text-[10px] text-muted-foreground font-mono">
                mysite.com
              </div>
            </div>
            <div className={cn(
              'h-[200px] transition-all duration-700 p-3',
              browserLoaded ? 'opacity-100' : 'opacity-0',
            )}>
              {/* Simplified website preview */}
              <div className="h-full rounded-lg bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-950/30 dark:to-blue-950/20 border border-violet-100 dark:border-violet-800/20 p-3 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-3 rounded bg-gradient-to-r from-violet-500 to-purple-600" />
                  <div className="flex-1" />
                  <div className="flex gap-2">
                    {['Home', 'About', 'Blog'].map((n) => (
                      <span key={n} className="text-[7px] text-zinc-500 font-medium">{n}</span>
                    ))}
                  </div>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-1.5">
                  <div className="text-[11px] font-bold text-zinc-700 dark:text-zinc-200">Build Something Amazing</div>
                  <div className="text-[8px] text-zinc-400 max-w-[140px]">Your next project starts here. Fast, modern, beautiful.</div>
                  <div className="flex gap-1.5 mt-1">
                    <div className="px-2 py-1 rounded bg-violet-600 text-[7px] text-white font-medium">Get Started</div>
                    <div className="px-2 py-1 rounded border border-violet-300 dark:border-violet-700 text-[7px] text-violet-600 dark:text-violet-400 font-medium">Learn More</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Routines card */}
          <div className="w-[240px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50">
              <CalendarClock className="size-3.5 text-violet-500" />
              <span className="text-xs font-medium">Routines</span>
            </div>
            <div className="p-2.5 space-y-2 min-h-[200px]">
              {ROUTINES.map((routine, i) => {
                if (!visibleRoutines.includes(i)) return null;
                return (
                  <div
                    key={routine.name}
                    className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 animate-in slide-in-from-right-3 fade-in duration-300"
                  >
                    <div className="size-6 rounded-full shrink-0 flex items-center justify-center mt-0.5">
                      <AgentIcon name={routine.agent} size={24} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{routine.name}</div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="size-2.5 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground">{routine.schedule}</span>
                      </div>
                    </div>
                    <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0 mt-1 ml-auto" />
                  </div>
                );
              })}
            </div>
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
    const t1 = setTimeout(() => setStep(1), 500);
    const t2 = setTimeout(() => setStep(2), 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center animate-in fade-in duration-500">
      {/* Agent icons */}
      <div className="flex items-center gap-6">
        {AGENTS.map((agent, i) => (
          <div
            key={agent.name}
            className={cn(
              'flex flex-col items-center gap-2 transition-all duration-500',
              step >= 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
            )}
            style={{ transitionDelay: `${i * 150}ms` }}
          >
            <div className="size-14 flex items-center justify-center">
              <AgentIcon name={agent.name} size={56} />
            </div>
            <span className="text-xs font-medium text-muted-foreground">{agent.label}</span>
          </div>
        ))}
      </div>

      {/* Tagline */}
      <div className={cn(
        'mt-8 text-center transition-all duration-700',
        step >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3',
      )}>
        <h2 className="text-2xl font-bold tracking-tight">Your agents. One workspace.</h2>
      </div>

      <div className={cn(
        'mt-3 text-center transition-all duration-700',
        step >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
      )}>
        <p className="text-sm text-muted-foreground">Connect your first agent to get started.</p>
      </div>
    </div>
  );
}

/* ─── Shared components ─── */

function SceneCaption({ text }: { text: string }) {
  return (
    <div className="text-center">
      <h3 className="text-lg sm:text-xl font-semibold tracking-tight text-foreground animate-in fade-in slide-in-from-bottom-2 duration-500">
        {text}
      </h3>
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
    }, 18);
    return () => clearInterval(interval);
  }, [text]);

  return (
    <span className={className}>
      {text.slice(0, count)}
      {count < text.length && <span className="inline-block w-0.5 h-3.5 bg-current opacity-70 animate-pulse ml-px align-middle" />}
    </span>
  );
}
