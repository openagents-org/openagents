'use client';

/* eslint-disable @next/next/no-img-element */

/**
 * DESIGN MOCK — agent marketplace for the "Add an agent to a node" flow.
 *
 * Standalone page for design iteration only (not linked from the app). Uses a
 * static snapshot of /v1/agent-catalog with simulated per-device detection so
 * every badge state is visible. Logos come from the live catalog API.
 *
 * Reference: the launcher's Marketplace page (hero spotlight, search +
 * category chips, status-dot badges) adapted to the workspace design tokens.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  ChevronLeft, Search, RefreshCw, ExternalLink, Plus, Sparkles,
  Moon, Sun, ArrowRight, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const LOGO_BASE = 'https://workspace-endpoint.openagents.org/v1/agent-catalog';

// ── Static catalog snapshot (live /v1/agent-catalog, 2026-08) ──────────────
type MockStatus = 'ready' | 'needs_login' | 'not_installed';

interface MockAgent {
  name: string;
  label: string;
  vendor: string;
  tagline: string;       // short marketing line for hero + cards
  description: string;
  tags: string[];
  status: MockStatus;    // simulated per-device detection
  featured?: boolean;
}

const AGENTS: MockAgent[] = [
  { name: 'claude', label: 'Claude Code', vendor: 'Anthropic', featured: true, status: 'needs_login',
    tagline: 'The gold standard for agentic coding, right in your terminal.',
    description: "Anthropic's official CLI agent for Claude", tags: ['coding', 'cli', 'anthropic'] },
  { name: 'openclaw', label: 'OpenClaw', vendor: 'Open source', featured: true, status: 'needs_login',
    tagline: 'Community-built agent with multi-model freedom.',
    description: 'Open-source coding agent with multi-model support', tags: ['coding', 'open-source'] },
  { name: 'codex', label: 'OpenAI Codex CLI', vendor: 'OpenAI', featured: true, status: 'not_installed',
    tagline: "GPT-5.5 powered engineering from OpenAI.",
    description: "OpenAI's coding agent for the terminal", tags: ['coding', 'openai', 'cli'] },
  { name: 'cursor', label: 'Cursor', vendor: 'Cursor', featured: true, status: 'ready',
    tagline: 'The AI editor you love — now headless on your node.',
    description: 'AI-powered code editor with agent mode CLI', tags: ['coding', 'editor', 'cli'] },
  { name: 'gemini', label: 'Gemini CLI', vendor: 'Google', featured: true, status: 'not_installed',
    tagline: "Google's open-source agent with a 1M-token context.",
    description: "Google's open-source AI agent for the command line", tags: ['coding', 'google', 'cli'] },
  { name: 'opencode', label: 'OpenCode', vendor: 'Open source', status: 'not_installed',
    tagline: 'Terminal-native, provider-agnostic, fully open.',
    description: 'Open-source terminal-native AI coding agent', tags: ['coding', 'open-source', 'terminal'] },
  { name: 'hermes', label: 'Hermes Agent', vendor: 'Nous Research', status: 'not_installed',
    tagline: 'Self-improving agent with tools and profiles.',
    description: 'Nous Hermes Agent — self-improving AI with tools, profiles, and memory', tags: ['coding', 'tools', 'orchestration'] },
  { name: 'kimi', label: 'Kimi', vendor: 'Moonshot AI', status: 'not_installed',
    tagline: 'Moonshot-powered agent, OpenAI-compatible.',
    description: 'Kimi agent powered by Moonshot AI, OpenAI-compatible API.', tags: ['coding', 'moonshot', 'open-source'] },
  { name: 'copilot', label: 'GitHub Copilot CLI', vendor: 'GitHub', status: 'not_installed',
    tagline: 'Your GitHub Copilot, now in the terminal.',
    description: "GitHub's official Copilot coding agent for the terminal", tags: ['coding', 'github', 'cli'] },
  { name: 'goose', label: 'Goose', vendor: 'Block', status: 'not_installed',
    tagline: 'Extensible developer agent from Block.',
    description: 'An open-source AI developer agent by Block (CLI — Beta)', tags: ['coding', 'developer', 'open-source'] },
  { name: 'aider', label: 'Aider', vendor: 'Open source', status: 'not_installed',
    tagline: 'AI pair programming that lives in git.',
    description: 'AI pair programming in your terminal', tags: ['coding', 'pair-programming', 'open-source'] },
  { name: 'amp', label: 'Amp', vendor: 'Sourcegraph', status: 'not_installed',
    tagline: "Sourcegraph's agent for CLI and VS Code.",
    description: "Sourcegraph's AI coding agent for CLI and VS Code", tags: ['coding', 'sourcegraph', 'vscode'] },
  { name: 'cline', label: 'Cline', vendor: 'Cline Bot', status: 'not_installed',
    tagline: 'Autonomous multi-step coding, safely gated.',
    description: 'Autonomous coding agent CLI by Cline Bot', tags: ['coding', 'cli', 'autonomous'] },
  { name: 'deepseek', label: 'DeepSeek Harness', vendor: 'DeepSeek', status: 'not_installed',
    tagline: 'Headless open-source harness for DeepSeek V4.',
    description: "DeepSeek's open-source agent harness (dsh) driven in headless mode", tags: ['coding', 'open-source', 'headless'] },
  { name: 'nanoclaw', label: 'NanoClaw', vendor: 'Open source', status: 'not_installed',
    tagline: 'Every agent group in its own container.',
    description: 'Containerized agent runtime — each Agent Group runs in its own Docker container', tags: ['coding', 'container', 'docker'] },
  { name: 'pi', label: 'Pi', vendor: 'Earendil', status: 'not_installed',
    tagline: 'Headless RPC coding agent, many providers.',
    description: "Earendil's Pi coding agent for the terminal — headless RPC mode, many providers", tags: ['coding', 'cli', 'rpc'] },
];

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'Ready on this device' },
  { key: 'open-source', label: 'Open source' },
  { key: 'cli', label: 'Terminal' },
  { key: 'editor', label: 'IDE & editor' },
] as const;

const STATUS_META: Record<MockStatus, { label: string; dot: string; text: string }> = {
  ready:         { label: 'Ready',           dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  needs_login:   { label: 'Needs login',     dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-500' },
  not_installed: { label: 'Installs on add', dot: 'bg-zinc-400',    text: 'text-muted-foreground' },
};

function Logo({ name, size, className }: { name: string; size: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/5 dark:ring-white/10 shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <img src={`${LOGO_BASE}/${name}/logo`} alt={name} width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} />
    </span>
  );
}

function StatusBadge({ status, className }: { status: MockStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[10.5px] font-medium whitespace-nowrap', m.text, className)}>
      <span className={cn('size-1.5 rounded-full', m.dot)} />
      {m.label}
    </span>
  );
}

// ── Hero spotlight ──────────────────────────────────────────────────────────
function Hero({ onPick }: { onPick: (name: string) => void }) {
  const slides = AGENTS.filter((a) => a.featured);
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % slides.length), 6000);
    return () => clearInterval(t);
  }, [slides.length]);
  const a = slides[i];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/[0.10] via-primary/[0.04] to-transparent">
      {/* ambient blooms */}
      <div className="pointer-events-none absolute -top-24 -left-24 size-72 rounded-full bg-primary/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 right-0 size-72 rounded-full bg-primary/10 blur-3xl" />

      <div key={a.name} className="relative flex items-center gap-6 px-6 py-6 sm:px-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <Logo name={a.name} size={84} className="rounded-2xl shadow-md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
            <Sparkles className="size-3" /> Featured
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight truncate">{a.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-lg">{a.tagline}</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => onPick(a.name)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-3.5" /> Add to this device
            </button>
            <span className="hidden sm:inline-flex"><StatusBadge status={a.status} /></span>
          </div>
        </div>
        {/* spec tiles */}
        <div className="hidden lg:flex flex-col gap-2 w-44 shrink-0">
          {[['Vendor', a.vendor], ['Runtime', 'CLI · Node.js'], ['On this device', STATUS_META[a.status].label]].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-background/70 backdrop-blur-sm ring-1 ring-border/60 px-3 py-2">
              <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">{k}</div>
              <div className="text-[11.5px] font-medium truncate">{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* dots */}
      <div className="relative flex items-center gap-1.5 px-6 sm:px-8 pb-4">
        {slides.map((s, idx) => (
          <button
            key={s.name}
            onClick={() => setI(idx)}
            aria-label={s.label}
            className={cn(
              'h-1.5 rounded-full transition-all duration-300',
              idx === i ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60',
            )}
          />
        ))}
      </div>
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────
function AgentCard({ a, onPick }: { a: MockAgent; onPick: (name: string) => void }) {
  return (
    <button
      onClick={() => onPick(a.name)}
      className="group relative flex flex-col gap-3 rounded-2xl border bg-background p-4 text-left transition-all duration-200 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/[0.06] hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-3">
        <Logo name={a.name} size={44} />
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="text-[13.5px] font-semibold leading-tight truncate">{a.label}</div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/80 truncate">{a.vendor}</div>
        </div>
        <StatusBadge status={a.status} className="pt-1" />
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground line-clamp-2 min-h-[33px]">{a.description}</p>

      <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
        <div className="flex items-center gap-1">
          {a.tags.slice(0, 2).map((t) => (
            <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{t}</span>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary opacity-0 translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
          Add <ArrowRight className="size-3" />
        </span>
      </div>
    </button>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function AgentMarketplaceMock() {
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [picked, setPicked] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return AGENTS.filter((a) => {
      if (cat === 'ready' && a.status === 'not_installed') return false;
      if (cat === 'open-source' && !a.tags.includes('open-source')) return false;
      if (cat === 'cli' && !(a.tags.includes('cli') || a.tags.includes('terminal'))) return false;
      if (cat === 'editor' && !(a.tags.includes('editor') || a.tags.includes('vscode'))) return false;
      if (!q) return true;
      return [a.name, a.label, a.vendor, a.description, ...a.tags].join(' ').toLowerCase().includes(q);
    });
  }, [query, cat]);

  const readyCount = AGENTS.filter((a) => a.status !== 'not_installed').length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-8 space-y-5">

        {/* Header */}
        <div className="flex items-start gap-3">
          <button className="mt-0.5 size-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
            <ChevronLeft className="size-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold tracking-tight">Add an agent to <span className="text-primary">sin1</span></h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {AGENTS.length} agents · <span className="text-emerald-600 dark:text-emerald-400 font-medium">{readyCount} detected on this device</span> · everything else installs automatically
            </p>
          </div>
          <button className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted transition-colors">
            <RefreshCw className="size-3" /> Re-detect
          </button>
          {/* mock-only theme toggle */}
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="inline-flex items-center rounded-lg border px-2 py-1.5 text-muted-foreground hover:bg-muted transition-colors"
            title="Toggle theme (mock only)"
          >
            {resolvedTheme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </button>
        </div>

        {/* Hero spotlight */}
        <Hero onPick={setPicked} />

        {/* Toolbar: search + categories */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search agents, vendors, tags…"
              className="w-full h-9 rounded-lg border bg-background pl-9 pr-3 text-xs outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-shadow"
            />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                onClick={() => setCat(c.key)}
                className={cn(
                  'whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors',
                  cat === c.key
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed py-16 text-center text-sm text-muted-foreground">
            Nothing matches “{query}”. <button className="text-primary font-medium" onClick={() => { setQuery(''); setCat('all'); }}>Reset filters</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((a) => <AgentCard key={a.name} a={a} onPick={setPicked} />)}
          </div>
        )}

        {/* pick feedback (mock) */}
        {picked && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-foreground text-background px-4 py-2 text-xs font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2">
            <CheckCircle2 className="size-3.5" /> Would open config for “{picked}” <button className="opacity-60 hover:opacity-100" onClick={() => setPicked(null)}>✕</button>
          </div>
        )}

        <p className="pt-2 text-center text-[10px] text-muted-foreground/50">
          Design mock — /mocks/agent-marketplace · data is a static snapshot; logos load from the live catalog API
          <ExternalLink className="ml-1 inline size-2.5" />
        </p>
      </div>
    </div>
  );
}
