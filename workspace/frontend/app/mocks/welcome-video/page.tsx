'use client';

// MOCK — first-run onboarding "welcome stage", simplified: the ~26s film
// plays full screen exactly once, with a skip button; ending or skipping
// hands off to the pairing-code step (represented by a placeholder here).
// Delete this route once the real welcome stage is implemented.

import { useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import WelcomeFilm from './welcome-film';

export default function WelcomeStageMock() {
  const [finished, setFinished] = useState(false);

  if (finished) {
    // Stand-in for the existing pairing-code onboarding step.
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-zinc-50 text-center">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
          Mock · handoff point
        </span>
        <h1 className="text-xl font-bold tracking-tight">→ Pairing-code step</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          In the real onboarding this is where the existing two-step flow
          (Connect a device → Add an agent) takes over.
        </p>
        <button
          onClick={() => setFinished(false)}
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          <RotateCcw className="size-3.5" />Replay the intro
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white">
      <WelcomeFilm embedded onEnded={() => setFinished(true)} />

      <span className="absolute left-4 top-4 z-50 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
        Mock · onboarding welcome stage
      </span>

      <button
        onClick={() => setFinished(true)}
        className="absolute bottom-6 right-6 z-50 inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white/80 px-4 py-2 text-sm font-medium text-zinc-600 shadow-sm backdrop-blur transition-colors hover:border-zinc-400 hover:text-zinc-900"
      >
        Skip intro
        <ArrowRight className="size-4" />
      </button>
    </div>
  );
}
