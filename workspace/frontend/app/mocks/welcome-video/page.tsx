'use client';

// MOCK — first-run onboarding "welcome stage": a 30s looping showcase film
// beside a live Yumi chat, with the pairing steps compressed into a strip
// below so the user sees the whole journey is short before committing.
// Layout mock only: the Yumi panel here is static; the real version wires
// the actual cloud-agent chat. Delete this route once implemented.

import { useState } from 'react';
import { ArrowRight, Check, Download, KeyRound, MessageSquare, Sparkles } from 'lucide-react';
import WelcomeFilm from './welcome-film';

const SUGGESTIONS = [
  'What can agents do here?',
  'Show me an example',
  'How do I connect my laptop?',
];

function YumiPanel() {
  const [asked, setAsked] = useState<string | null>(null);
  return (
    <div className="flex h-full flex-col rounded-2xl border bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="relative">
          <img src="/yumi-avatar.png" alt="Yumi" className="size-9 rounded-full" />
          <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">Yumi</div>
          <div className="text-[11px] text-muted-foreground leading-tight">Your guide · no install needed</div>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">
          <Sparkles className="size-3" />Live agent
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
        <div className="flex gap-2.5">
          <img src="/yumi-avatar.png" alt="" className="size-6 shrink-0 rounded-full mt-0.5" />
          <div className="space-y-2">
            <p className="leading-relaxed">
              Hi! I&apos;m Yumi — I already live in this workspace, so you can talk to me right now,
              before installing anything. 👋
            </p>
            <p className="leading-relaxed text-muted-foreground">
              Ask me anything about what agents can do here, or tell me what you&apos;re working on
              and I&apos;ll suggest a setup.
            </p>
          </div>
        </div>
        {asked && (
          <>
            <div className="flex justify-end">
              <div className="rounded-2xl bg-zinc-100 px-3.5 py-2">{asked}</div>
            </div>
            <div className="flex gap-2.5">
              <img src="/yumi-avatar.png" alt="" className="size-6 shrink-0 rounded-full mt-0.5" />
              <div className="flex items-center gap-1 py-2">
                <span className="size-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:0ms]" />
                <span className="size-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:120ms]" />
                <span className="size-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:240ms]" />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="border-t px-4 py-3 space-y-2.5">
        {!asked && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setAsked(s)}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:border-indigo-300 hover:text-indigo-600 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-xl border bg-zinc-50 px-3 py-2 text-sm text-muted-foreground">
          <MessageSquare className="size-4 shrink-0" />
          Message Yumi… <span className="ml-auto text-[10px] uppercase tracking-wide">mock</span>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { icon: Download, title: 'Download the launcher', detail: 'macOS · Windows · Linux CLI' },
  { icon: KeyRound, title: 'Enter your pairing code', detail: 'One code links your device' },
  { icon: MessageSquare, title: 'Chat with your agent', detail: 'Claude, Codex, Aider & more' },
];

export default function WelcomeStageMock() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
        <div className="mb-1 flex items-center gap-2">
          <img src="/logo-icon.png" alt="OpenAgents" className="size-6" />
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
            Mock · onboarding welcome stage
          </span>
        </div>

        <div className="mb-6 mt-3">
          <h1 className="text-2xl font-bold tracking-tight">Welcome to your workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s what your agent team can do — watch 30 seconds, or just ask Yumi.
          </p>
        </div>

        {/* One shared band: the film sets the height, Yumi matches it — the
            chat must not stretch taller and push the steps below the fold. */}
        <div className="grid grid-cols-1 gap-5 lg:h-[520px] lg:grid-cols-5">
          <div className="flex flex-col lg:col-span-3">
            <div className="relative min-h-[320px] flex-1 overflow-hidden rounded-2xl border shadow-sm">
              <WelcomeFilm embedded />
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              30-second tour · loops silently ·{' '}
              <a className="underline underline-offset-2 hover:text-foreground" href="#">watch the full film</a>
            </p>
          </div>
          <div className="min-h-[380px] pb-7 lg:col-span-2">
            <YumiPanel />
          </div>
        </div>

        <div className="mt-6 rounded-2xl border bg-white px-6 py-5 shadow-sm">
          <div className="flex flex-col items-center gap-5 lg:flex-row">
            <ol className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:gap-0">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex flex-1 items-center">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                      <s.icon className="size-4" />
                    </span>
                    <div>
                      <div className="text-[13px] font-semibold leading-tight">{s.title}</div>
                      <div className="text-[11px] text-muted-foreground leading-tight">{s.detail}</div>
                    </div>
                  </div>
                  {i < STEPS.length - 1 && (
                    <ArrowRight className="mx-4 hidden size-4 shrink-0 text-zinc-300 sm:block" />
                  )}
                </li>
              ))}
            </ol>
            <div className="flex flex-col items-center gap-1.5">
              <button className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors">
                Connect your first agent
                <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold">~2 min</span>
              </button>
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                <Check className="size-3" />+$20 in free API credits when it connects
              </span>
            </div>
          </div>
        </div>

        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          I know what I&apos;m doing —{' '}
          <a className="underline underline-offset-2 hover:text-foreground" href="#">skip to the pairing code</a>
        </p>
      </div>
    </div>
  );
}
