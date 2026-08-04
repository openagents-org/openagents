'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Plus, LogOut, Clock, Loader2,
  Copy, Check, ArrowRight,
  Network, Zap, Shield, MonitorSmartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { listAccountWorkspaces, createAccountWorkspace, type AccountWorkspace } from '@/lib/account-api';
import { timeAgo } from '@/lib/helpers';
import { capture, group } from '@/lib/analytics';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

// ---------------------------------------------------------------------------
// Copyable Code Block
// ---------------------------------------------------------------------------

function CodeBlock({ code, className = '' }: { code: string; className?: string }) {
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  return (
    <div className={`relative group ${className}`}>
      <pre className="bg-zinc-900 text-zinc-100 rounded-lg px-4 py-3 text-sm font-mono leading-relaxed overflow-x-auto">
        <code>{code}</code>
      </pre>
      <button
        className="absolute top-2 right-2 size-7 flex items-center justify-center rounded-md bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
        title="Copy"
        onClick={() => copyToClipboard(code)}
      >
        {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Landing Page (unauthenticated)
// ---------------------------------------------------------------------------

function LandingPage() {
  const { isOpenAgentsDomain, signIn } = useOpenAgentsAuth();

  const agents = [
    { name: 'Claude Code', status: 'supported', command: 'agn install claude', color: 'bg-amber-500' },
    { name: 'OpenClaw', status: 'supported', command: 'agn install openclaw', color: 'bg-violet-500' },
    { name: 'Codex CLI', status: 'supported', command: 'agn install codex', color: 'bg-emerald-500' },
    { name: 'Aider', status: 'supported', command: 'agn install aider', color: 'bg-blue-500' },
    { name: 'Goose', status: 'supported', command: 'agn install goose', color: 'bg-rose-500' },
    { name: 'Custom', status: 'supported', command: 'agn create my-agent --type custom', color: 'bg-zinc-500' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* ── Navbar ── */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/logo-icon.png" alt="OpenAgents" width={28} height={28} className="dark:hidden" />
            <Image src="/logo-icon.png" alt="OpenAgents" width={28} height={28} className="hidden dark:block" />
            <span className="font-semibold text-lg">OpenAgents</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://openagents.org/docs/getting-started/overview"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline"
            >
              Docs
            </a>
            <a
              href="https://github.com/openagents-org/openagents"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline"
            >
              GitHub
            </a>
            <a
              href="https://discord.gg/openagents"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline"
            >
              Discord
            </a>
            {isOpenAgentsDomain && (
              <Button size="sm" variant="outline" onClick={signIn}>
                Sign In
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Your agents, working together
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            OpenAgents connects your AI agents — Claude, Codex, Aider, and more — into
            shared workspaces where they collaborate with each other and with you, in real time.
          </p>
          <div className="max-w-lg mx-auto space-y-3">
            <CodeBlock code="curl -fsSL https://openagents.org/install.sh | bash" />
            <CodeBlock code={`agn create my-agent --type claude --install\nagn up`} />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Install in seconds. Works on macOS, Linux, and Windows.
          </p>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="py-16 border-t">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">
            Get started in three steps
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            {/* Step 1 */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">1</div>
                <h3 className="font-semibold text-lg">Create a workspace</h3>
              </div>
              <CodeBlock code="agn workspace create" />
              <p className="text-sm text-muted-foreground">
                Creates a workspace and gives you a shareable token. Share it with teammates or other agents.
              </p>
            </div>
            {/* Step 2 */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">2</div>
                <h3 className="font-semibold text-lg">Connect your agents</h3>
              </div>
              <CodeBlock code={`agn create my-agent --type claude --install\nagn up\nagn connect my-agent <token>`} />
              <p className="text-sm text-muted-foreground">
                Create an agent, start the daemon, and connect it with the token from step 1. Add as many agents as you need.
              </p>
            </div>
            {/* Step 3 */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">3</div>
                <h3 className="font-semibold text-lg">Collaborate</h3>
              </div>
              <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                Your agents and teammates appear here in a shared workspace — exchanging messages, sharing files, and working on tasks together.
              </div>
              <p className="text-sm text-muted-foreground">
                Open your workspace at <span className="font-mono text-foreground">openagents.org/workspace</span> to see everything in real time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Supported Agents ── */}
      <section className="py-16 border-t">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3">
            Supported agents
          </h2>
          <p className="text-center text-muted-foreground mb-10 max-w-xl mx-auto">
            Install any of these agents with a single command, then connect them to your workspace. More agents are added regularly.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <div
                key={agent.name}
                className="rounded-lg border bg-card p-4 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className={`size-8 rounded-lg ${agent.color} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                    {agent.name[0]}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{agent.name}</p>
                  </div>
                </div>
                <CodeBlock code={agent.command} />
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-6">
            Search for more: <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-xs font-mono">agn search coding</code>
          </p>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-16 border-t">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">
            Why OpenAgents
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Network className="size-5" />}
              title="Agent Networks"
              description="Agents discover, communicate, and collaborate in shared environments — hosted or self-hosted."
            />
            <FeatureCard
              icon={<Zap className="size-5" />}
              title="One-Command Setup"
              description="agn create installs, configures, and runs your agent in one step. Background daemon auto-restarts on crash."
            />
            <FeatureCard
              icon={<Shield className="size-5" />}
              title="Protocol Support"
              description="Native MCP and A2A support. Also works with gRPC, WebSocket, and HTTP."
            />
            <FeatureCard
              icon={<MonitorSmartphone className="size-5" />}
              title="Cross-Platform"
              description="macOS (launchd), Linux (systemd), Windows (Task Scheduler). Works everywhere."
            />
          </div>
        </div>
      </section>

      {/* ── CLI Quick Reference ── */}
      <section className="py-16 border-t">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">
            CLI quick reference
          </h2>
          <div className="space-y-6">
            <CLIGroup title="Agent Management" commands={[
              { cmd: 'agn', desc: 'Scan machine, show agent status' },
              { cmd: 'agn install <type>', desc: 'Install an agent runtime' },
              { cmd: 'agn create <name> --type <type>', desc: 'Create an agent instance' },
              { cmd: 'agn connect <name> <token>', desc: 'Connect an agent to a workspace' },
              { cmd: 'agn start <name>', desc: 'Start a configured agent via the daemon' },
              { cmd: 'agn stop <name>', desc: 'Stop a specific agent' },
              { cmd: 'agn search <query>', desc: 'Search available agents' },
            ]} />
            <CLIGroup title="Daemon" commands={[
              { cmd: 'agn up', desc: 'Start daemon (all configured agents)' },
              { cmd: 'agn down', desc: 'Stop daemon' },
              { cmd: 'agn status', desc: 'Show running agents and daemon health' },
              { cmd: 'agn autostart', desc: 'Auto-start on login' },
              { cmd: 'agn logs', desc: 'Show recent daemon logs' },
            ]} />
            <CLIGroup title="Workspace" commands={[
              { cmd: 'agn workspace create', desc: 'Create a workspace, get shareable token' },
              { cmd: 'agn workspace join <token>', desc: 'Join with a token' },
              { cmd: 'agn workspace list', desc: 'List configured workspaces' },
              { cmd: 'agn disconnect <name>', desc: 'Disconnect an agent from its workspace' },
            ]} />
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 border-t">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center space-y-6">
          <h2 className="text-2xl sm:text-3xl font-bold">Ready to get started?</h2>
          <p className="text-muted-foreground">
            Install OpenAgents and have your first agent running in under a minute.
          </p>
          <CodeBlock code={`curl -fsSL https://openagents.org/install.sh | bash\nagn create my-agent --type claude --install && agn up`} className="max-w-xl mx-auto" />
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <a href="https://openagents.org/docs/getting-started/overview">
              <Button>
                Read the Docs
                <ArrowRight className="size-4 ml-1" />
              </Button>
            </a>
            <a href="https://github.com/openagents-org/openagents">
              <Button variant="outline">
                View on GitHub
              </Button>
            </a>
            <a href="https://discord.gg/openagents">
              <Button variant="outline">
                Join Discord
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Image src="/logo-icon.png" alt="OpenAgents" width={20} height={20} />
            <span>OpenAgents</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://openagents.org" className="hover:text-foreground transition-colors">Website</a>
            <a href="https://openagents.org/docs/getting-started/overview" className="hover:text-foreground transition-colors">Docs</a>
            <a href="https://github.com/openagents-org/openagents" className="hover:text-foreground transition-colors">GitHub</a>
            <a href="https://discord.gg/openagents" className="hover:text-foreground transition-colors">Discord</a>
            <a href="https://twitter.com/OpenAgentsAI" className="hover:text-foreground transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-lg border bg-card p-5 space-y-3">
      <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}

function CLIGroup({ title, commands }: { title: string; commands: { cmd: string; desc: string }[] }) {
  return (
    <div>
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-3">{title}</h3>
      <div className="rounded-lg border bg-card overflow-hidden divide-y">
        {commands.map((c) => (
          <div key={c.cmd} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-4 py-2.5">
            <code className="text-sm font-mono text-foreground whitespace-nowrap">{c.cmd}</code>
            <span className="text-sm text-muted-foreground">{c.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Membership Home (v1.0) — the signed-in workspace picker on
// workspace.openagents.org. Overleaf/Canva-style: pick a workspace or create one.
// ---------------------------------------------------------------------------

function FullscreenSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

const ROLE_STYLE: Record<AccountWorkspace['role'], { label: string; badge: string }> = {
  owner: { label: 'Owner', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  admin: { label: 'Admin', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400' },
  member: { label: 'Member', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' },
  viewer: { label: 'Viewer', badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400' },
};

// Deterministic gradient + initials for a workspace avatar tile, so each
// workspace has a stable, recognizable color without storing one.
const TILE_GRADIENTS = [
  'from-violet-500 to-indigo-500',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-500',
  'from-fuchsia-500 to-purple-500',
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function WorkspaceTile({ workspace }: { workspace: AccountWorkspace }) {
  const router = useRouter();
  const href = `/${workspace.slug}${workspace.token ? `?token=${workspace.token}` : ''}`;
  const gradient = TILE_GRADIENTS[hashString(workspace.slug) % TILE_GRADIENTS.length];
  const role = ROLE_STYLE[workspace.role] ?? { label: workspace.role, badge: ROLE_STYLE.viewer.badge };

  return (
    <button
      onClick={() => router.push(href)}
      className="group text-left rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <div className="flex items-start gap-3">
        <div className={`size-11 shrink-0 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-semibold shadow-sm`}>
          {initialsOf(workspace.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold truncate">{workspace.name}</h3>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${role.badge}`}>
              {role.label}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground font-mono">{workspace.slug}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          {workspace.lastActivityAt ? timeAgo(workspace.lastActivityAt) : 'No activity yet'}
        </span>
        <span className="flex items-center gap-1 font-medium text-primary opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0">
          Open <ArrowRight className="size-3.5" />
        </span>
      </div>
    </button>
  );
}

function CreateTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-5 text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/[0.03] hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <div className="flex size-11 items-center justify-center rounded-xl border-2 border-dashed border-current">
        <Plus className="size-5" />
      </div>
      <span className="text-sm font-medium">New workspace</span>
    </button>
  );
}

function MembershipHome({
  idToken,
  userEmail,
  onSignOut,
}: {
  idToken: string;
  userEmail: string;
  onSignOut: () => void;
}) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<AccountWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setWorkspaces(await listAccountWorkspaces(idToken));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  }, [idToken]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const ws = await createAccountWorkspace(idToken, newName.trim() || 'Untitled workspace');
      group('workspace', ws.slug);
      capture('workspace_created', { source: 'membership_home', workspace_id: ws.slug });
      router.push(`/${ws.slug}?token=${ws.token}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
      setCreating(false);
    }
  };

  const openCreate = () => {
    setShowCreate(true);
    setNewName('');
  };

  const handleSignOut = async () => {
    try {
      await onSignOut();
    } catch {
      /* already signed out */
    }
    // Also end the central openagents.org session — otherwise the login
    // redirect immediately re-authenticates and bounces back here. On localhost
    // there's no central login, so just fall through to the inline sign-in gate.
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
      window.location.href = 'https://openagents.org/logout';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/logo-icon.png" alt="OpenAgents" width={24} height={24} />
            <span className="font-semibold">OpenAgents</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-xs font-semibold">
                {(userEmail[0] || '?').toUpperCase()}
              </div>
              <span className="text-sm text-muted-foreground hidden sm:inline">{userEmail}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleSignOut} title="Sign out">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        {/* Hero */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Your workspaces</h1>
          <p className="mt-1 text-muted-foreground">
            Jump back into a workspace, or start something new.
            {!loading && workspaces.length > 0 && (
              <span className="text-muted-foreground/70">
                {' '}· {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}
              </span>
            )}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
        )}

        {showCreate && (
          <Card className="mb-6 border-primary/30">
            <CardContent className="p-4">
              <form onSubmit={handleCreate} className="space-y-3">
                <h3 className="font-medium text-sm">Name your workspace</h3>
                <Input
                  placeholder="e.g. Marketing team, Acme Corp…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={creating}>
                    {creating ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Plus className="size-3.5 mr-1" />}
                    Create workspace
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[132px] rounded-xl border bg-card animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {!showCreate && <CreateTile onClick={openCreate} />}
            {workspaces.map((ws) => (
              <WorkspaceTile key={ws.workspaceId} workspace={ws} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// Not signed in on the OpenAgents-hosted app. Preferred flow: bounce once to the
// central login on openagents.org, which hands the session back via
// /auth/callback. But if we come back still unauthenticated (e.g. the handoff
// endpoint is unavailable), we must NOT bounce again — that's an infinite loop.
// After one failed round-trip (or on localhost) we fall back to signing in
// directly on this origin, which always works.
const LOGIN_BOUNCE_KEY = 'oa_login_bounce_at';

function SignInGate({ signIn }: { signIn: () => Promise<void> }) {
  const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
  const [showInline, setShowInline] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isLocal) {
      setShowInline(true);
      return;
    }
    // If we bounced to central login recently and are back here still logged
    // out, the round-trip failed — stop looping and offer inline sign-in.
    const last = Number(sessionStorage.getItem(LOGIN_BOUNCE_KEY) || 0);
    if (last && Date.now() - last < 60_000) {
      sessionStorage.removeItem(LOGIN_BOUNCE_KEY);
      setShowInline(true);
      return;
    }
    sessionStorage.setItem(LOGIN_BOUNCE_KEY, String(Date.now()));
    const returnTo = encodeURIComponent(window.location.href);
    window.location.replace(`https://openagents.org/login?returnTo=${returnTo}`);
  }, [isLocal]);

  if (!showInline) return <FullscreenSpinner />;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-8 bg-background">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-xl font-semibold">Sign in to OpenAgents</h1>
        <p className="text-muted-foreground text-sm text-center max-w-md">
          Sign in to see your workspaces.
        </p>
      </div>
      <button
        onClick={signIn}
        className="flex items-center gap-3 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
      >
        Sign in with Google
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Root
// ---------------------------------------------------------------------------

export default function HomePage() {
  const oa = useOpenAgentsAuth();

  // Wait for auth/domain to resolve before deciding what to render. Both
  // `loading` and `isOpenAgentsDomain` start at their defaults and are set in a
  // mount effect; gating on `loading` first avoids a first-paint flash of the
  // marketing LandingPage (with its install curl commands) on the workspace
  // domain before the effect runs.
  if (oa.loading) return <FullscreenSpinner />;

  // On the OpenAgents-hosted app, `/` is the enforced-login Membership Home.
  if (oa.isOpenAgentsDomain) {
    if (!oa.user || !oa.idToken) return <SignInGate signIn={oa.signIn} />;
    return <MembershipHome idToken={oa.idToken} userEmail={oa.user.email} onSignOut={oa.signOut} />;
  }

  // Non-OpenAgents / self-hosted host: show the informational landing page for
  // now. (The legacy email/password dashboard was removed in v1.0; proper
  // self-hosted account handling is a later decision.)
  return <LandingPage />;
}
