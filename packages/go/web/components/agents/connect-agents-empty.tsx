'use client';

// Connect-agents empty state — web mirror of Swift's `ConnectAgentsView`
// (Views/ConnectAgentsView.swift). Shown when the active workspace has no
// agents yet (the state right after creating one). Agents run on the user's own
// machine via the OpenAgents CLI, so this hands over the command + token and
// lets the user re-check membership.

import { useState } from 'react';
import { Cpu, Copy, Check, Eye, EyeOff, RefreshCw, ArrowUpRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/lib/workspace-context';
import { copyTextToClipboard } from '@/lib/clipboard';

// Public download page for the desktop Launcher (placeholder — point at the
// real release page before shipping).
const LAUNCHER_URL = 'https://openagents.org/download';

export function ConnectAgentsEmpty() {
  const { workspace, token, refreshAgents } = useWorkspace();
  const [refreshing, setRefreshing] = useState(false);

  const installCommand = 'npm install -g @openagents-org/agent-connector';
  const connectCommand = `agn connect my-agent ${token}`;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAgents();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="max-w-[520px] mx-auto px-6 py-10 space-y-6">
        <div className="space-y-2">
          <Cpu className="size-6 text-primary" />
          <h1 className="text-xl font-semibold">Connect an agent</h1>
          <p className="text-sm text-muted-foreground">
            “{workspace?.name || 'This workspace'}” has no agents yet. Agents run on your
            own machine and join over the OpenAgents CLI — set one up in under a minute.
          </p>
        </div>

        <StepCard
          number={1}
          title="Install the agent connector"
          detail="On the computer where your agent will run:"
          command={installCommand}
        />
        <StepCard
          number={2}
          title="Connect an agent to this workspace"
          detail="Creates an agent and joins it here. Swap `my-agent` for any name."
          command={connectCommand}
        />

        <div className="rounded-xl border border-input p-4 space-y-2">
          <p className="text-[10px] font-medium tracking-wider text-muted-foreground">
            WORKSPACE
          </p>
          <LabeledValue label="ID" value={workspace?.slug || ''} />
          <LabeledValue label="Token" value={token} secret />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Prefer a desktop app?</p>
          <a
            href={LAUNCHER_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border border-input p-3 text-sm hover:bg-muted/60 transition-colors"
          >
            <Download className="size-4" />
            Download the OpenAgents Launcher
            <ArrowUpRight className="size-3.5 ml-auto text-muted-foreground" />
          </a>
        </div>

        <Button onClick={handleRefresh} disabled={refreshing} className="w-full">
          {refreshing ? (
            <RefreshCw className="size-4 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="size-4 mr-1" />
          )}
          {refreshing ? 'Checking…' : "I've connected an agent"}
        </Button>
      </div>
    </div>
  );
}

function StepCard({
  number,
  title,
  detail,
  command,
}: {
  number: number;
  title: string;
  detail: string;
  command: string;
}) {
  return (
    <div className="rounded-xl border border-input p-3.5 space-y-2.5">
      <div className="flex items-start gap-2.5">
        <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
          {number}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
      <CommandRow command={command} />
    </div>
  );
}

function CommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyTextToClipboard(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/40 px-3 py-2.5">
      <code className="flex-1 min-w-0 truncate font-mono text-xs">{command}</code>
      <button
        onClick={copy}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Copy command"
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function LabeledValue({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyTextToClipboard(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };
  const shown = secret && !revealed ? '•'.repeat(Math.min(value.length, 24)) : value;
  return (
    <div className="flex items-center gap-2">
      <span className="w-11 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <code className="flex-1 min-w-0 truncate font-mono text-xs">{shown}</code>
      {secret && (
        <button
          onClick={() => setRevealed((v) => !v)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={revealed ? 'Hide token' : 'Show token'}
        >
          {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      )}
      <button
        onClick={copy}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
