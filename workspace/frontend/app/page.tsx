'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Bot, Plus, LogOut, Users, Clock, Archive, Loader2,
  Terminal, Copy, Check, ArrowRight, Download,
  Network, Zap, Shield, MonitorSmartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { listMyWorkspaces, createWorkspace, type WorkspaceSummary } from '@/lib/dashboard-api';
import { useFormatters, useT } from '@/lib/i18n';
import { capture, group } from '@/lib/analytics';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

// ---------------------------------------------------------------------------
// Copyable Code Block
// ---------------------------------------------------------------------------

function CodeBlock({ code, className = '' }: { code: string; className?: string }) {
  const t = useT();
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  return (
    <div className={`relative group ${className}`}>
      <pre className="bg-zinc-900 text-zinc-100 rounded-lg px-4 py-3 text-sm font-mono leading-relaxed overflow-x-auto">
        <code>{code}</code>
      </pre>
      <button
        className="absolute top-2 right-2 size-7 flex items-center justify-center rounded-md bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
        title={t('landing.copy')}
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
  const t = useT();
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
              {t('landing.docs')}
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
                {t('landing.signIn')}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            {t('landing.heroTitle')}
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            {t('landing.heroBody')}
          </p>
          <div className="max-w-lg mx-auto space-y-3">
            <CodeBlock code="curl -fsSL https://openagents.org/install.sh | bash" />
            <CodeBlock code={`agn create my-agent --type claude --install\nagn up`} />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {t('landing.heroNote')}
          </p>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="py-16 border-t">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">
            {t('landing.stepsTitle')}
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            {/* Step 1 */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">1</div>
                <h3 className="font-semibold text-lg">{t('landing.step1Title')}</h3>
              </div>
              <CodeBlock code="agn workspace create" />
              <p className="text-sm text-muted-foreground">
                {t('landing.step1Body')}
              </p>
            </div>
            {/* Step 2 */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">2</div>
                <h3 className="font-semibold text-lg">{t('landing.step2Title')}</h3>
              </div>
              <CodeBlock code={`agn create my-agent --type claude --install\nagn up\nagn connect my-agent <token>`} />
              <p className="text-sm text-muted-foreground">
                {t('landing.step2Body')}
              </p>
            </div>
            {/* Step 3 */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">3</div>
                <h3 className="font-semibold text-lg">{t('landing.step3Title')}</h3>
              </div>
              <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                {t('landing.step3Card')}
              </div>
              <p className="text-sm text-muted-foreground">
                {t('landing.step3BodyBefore')}{' '}
                <span className="font-mono text-foreground">openagents.org/workspace</span>{' '}
                {t('landing.step3BodyAfter')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Supported Agents ── */}
      <section className="py-16 border-t">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3">
            {t('landing.agentsTitle')}
          </h2>
          <p className="text-center text-muted-foreground mb-10 max-w-xl mx-auto">
            {t('landing.agentsBody')}
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
            {t('landing.agentsSearchBefore')}{' '}
            <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-xs font-mono">agn search coding</code>
          </p>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-16 border-t">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">
            {t('landing.featuresTitle')}
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Network className="size-5" />}
              title={t('landing.featureNetworksTitle')}
              description={t('landing.featureNetworksBody')}
            />
            <FeatureCard
              icon={<Zap className="size-5" />}
              title={t('landing.featureSetupTitle')}
              description={t('landing.featureSetupBody')}
            />
            <FeatureCard
              icon={<Shield className="size-5" />}
              title={t('landing.featureProtocolTitle')}
              description={t('landing.featureProtocolBody')}
            />
            <FeatureCard
              icon={<MonitorSmartphone className="size-5" />}
              title={t('landing.featureCrossPlatformTitle')}
              description={t('landing.featureCrossPlatformBody')}
            />
          </div>
        </div>
      </section>

      {/* ── CLI Quick Reference ── */}
      <section className="py-16 border-t">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">
            {t('landing.cliTitle')}
          </h2>
          <div className="space-y-6">
            <CLIGroup title={t('landing.cliGroupAgent')} commands={[
              { cmd: 'agn', desc: t('landing.cliScanMachine') },
              { cmd: 'agn install <type>', desc: t('landing.cliInstallRuntime') },
              { cmd: 'agn create <name> --type <type>', desc: t('landing.cliCreateInstance') },
              { cmd: 'agn connect <name> <token>', desc: t('landing.cliConnectWorkspace') },
              { cmd: 'agn start <name>', desc: t('landing.cliStartAgent') },
              { cmd: 'agn stop <name>', desc: t('landing.cliStopAgent') },
              { cmd: 'agn search <query>', desc: t('landing.cliSearchAgents') },
            ]} />
            <CLIGroup title={t('landing.cliGroupDaemon')} commands={[
              { cmd: 'agn up', desc: t('landing.cliDaemonUp') },
              { cmd: 'agn down', desc: t('landing.cliDaemonDown') },
              { cmd: 'agn status', desc: t('landing.cliDaemonStatus') },
              { cmd: 'agn autostart', desc: t('landing.cliAutostart') },
              { cmd: 'agn logs', desc: t('landing.cliLogs') },
            ]} />
            <CLIGroup title={t('landing.cliGroupWorkspace')} commands={[
              { cmd: 'agn workspace create', desc: t('landing.cliWorkspaceCreate') },
              { cmd: 'agn workspace join <token>', desc: t('landing.cliWorkspaceJoin') },
              { cmd: 'agn workspace list', desc: t('landing.cliWorkspaceList') },
              { cmd: 'agn disconnect <name>', desc: t('landing.cliDisconnect') },
            ]} />
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 border-t">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center space-y-6">
          <h2 className="text-2xl sm:text-3xl font-bold">{t('landing.ctaTitle')}</h2>
          <p className="text-muted-foreground">
            {t('landing.ctaBody')}
          </p>
          <CodeBlock code={`curl -fsSL https://openagents.org/install.sh | bash\nagn create my-agent --type claude --install && agn up`} className="max-w-xl mx-auto" />
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <a href="https://openagents.org/docs/getting-started/overview">
              <Button>
                {t('landing.ctaReadDocs')}
                <ArrowRight className="size-4 ml-1" />
              </Button>
            </a>
            <a href="https://github.com/openagents-org/openagents">
              <Button variant="outline">
                {t('landing.ctaViewGitHub')}
              </Button>
            </a>
            <a href="https://discord.gg/openagents">
              <Button variant="outline">
                {t('landing.ctaJoinDiscord')}
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
            <a href="https://openagents.org" className="hover:text-foreground transition-colors">{t('landing.footerWebsite')}</a>
            <a href="https://openagents.org/docs/getting-started/overview" className="hover:text-foreground transition-colors">{t('landing.docs')}</a>
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
// Create Workspace Dialog (inline)
// ---------------------------------------------------------------------------

function CreateWorkspaceForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [agentName, setAgentName] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName.trim()) return;
    setError('');
    setLoading(true);
    try {
      const ws = await createWorkspace(agentName.trim(), name.trim() || undefined);
      group('workspace', ws.slug);
      capture('workspace_created', {
        source: 'workspace_app',
        workspace_id: ws.slug,
        agent_name: agentName.trim(),
      });
      onCreated();
      router.push(`/${ws.slug}?token=${ws.token}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('dashboard.createFailed'));
      setLoading(false);
    }
  };

  return (
    <Card className="border-dashed">
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <h3 className="font-medium text-sm">{t('dashboard.createTitle')}</h3>
          <div className="space-y-2">
            <Input
              placeholder={t('dashboard.agentNamePlaceholder')}
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              required
              autoFocus
            />
            <Input
              placeholder={t('dashboard.workspaceNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? <Loader2 className="size-3 animate-spin mr-1" /> : <Plus className="size-3 mr-1" />}
              {t('common.create')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Workspace Card
// ---------------------------------------------------------------------------

function WorkspaceCard({ workspace }: { workspace: WorkspaceSummary }) {
  const t = useT();
  const { timeAgo } = useFormatters();
  const router = useRouter();

  return (
    <Card
      className="cursor-pointer transition-colors hover:border-primary/30 hover:bg-accent/5"
      onClick={() => router.push(`/${workspace.slug}?token=${workspace.token}`)}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-medium truncate">{workspace.name}</h3>
            <p className="text-xs text-muted-foreground font-mono">{workspace.slug}</p>
          </div>
          <Badge variant={workspace.status === 'active' ? 'primary' : 'secondary'} className="shrink-0 text-xs">
            {workspace.status === 'archived' && <Archive className="size-3 mr-1" />}
            {workspace.status === 'archived' ? t('dashboard.statusArchived') : t('dashboard.statusActive')}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="size-3" />
            {t('dashboard.agentCount', { count: workspace.agentCount })}
          </span>
          {workspace.lastActivityAt && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {timeAgo(workspace.lastActivityAt)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard() {
  const t = useT();
  const { user, logout } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listMyWorkspaces();
      setWorkspaces(data.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('dashboard.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bot className="size-5 text-primary" />
            <h1 className="font-semibold">{t('dashboard.title')}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:inline">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Actions bar */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-muted-foreground">
            {loading ? t('common.loading') : t('dashboard.workspaceCount', { count: workspaces.length })}
          </p>
          {!showCreate && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="size-4 mr-1" />
              {t('dashboard.newWorkspace')}
            </Button>
          )}
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <div className="mb-6">
            <CreateWorkspaceForm
              onCreated={() => {
                setShowCreate(false);
                load();
              }}
              onCancel={() => setShowCreate(false)}
            />
          </div>
        )}

        {/* Workspace grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : workspaces.length === 0 ? (
          <div className="text-center py-20 space-y-3">
            <Bot className="size-10 mx-auto text-muted-foreground/40" />
            <p className="text-muted-foreground">{t('dashboard.emptyTitle')}</p>
            <p className="text-sm text-muted-foreground/70">
              {t('dashboard.emptyBody')}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((ws) => (
              <WorkspaceCard key={ws.workspaceId} workspace={ws} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Root
// ---------------------------------------------------------------------------

export default function HomePage() {
  const { user, loading } = useAuth();
  const openAgentsAuth = useOpenAgentsAuth();

  if (loading || openAgentsAuth.loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Logged in via either auth system → show dashboard
  if (user || openAgentsAuth.user) return <Dashboard />;

  // Not logged in → show landing page
  return <LandingPage />;
}
