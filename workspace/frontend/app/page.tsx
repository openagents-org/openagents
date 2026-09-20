'use client';

import { desktopHost } from '@/lib/desktop-host';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Plus, LogOut, Clock, Loader2,
  Copy, Check, ArrowRight,
  Network, Zap, Shield, MonitorSmartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { listAccountWorkspaces, createAccountWorkspace, getCampaignStatus, type AccountWorkspace, type CampaignStatus } from '@/lib/account-api';
import { capture, group } from '@/lib/analytics';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useFormatters, useT, type MessageKey } from '@/lib/i18n';

/** A catalogue key, translated at render time, or a raw message from an Error. */
type ErrorMessage = { key: MessageKey } | { text: string };

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
                <div className="size-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">1</div>
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
                <div className="size-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">2</div>
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
                <div className="size-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">3</div>
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
// Membership Home (v1.0) — the signed-in workspace picker on
// workspace.openagents.org. Overleaf/Canva-style: pick a workspace or create one.
// ---------------------------------------------------------------------------

// Brand palette + neo-brutalist primitives, mirroring the openagents.org
// marketing site (hard black borders, offset shadows, bold display type).
const BRAND = {
  navy: '#0B1121',
  blue: '#2F6BFF',
  blueDark: '#1d4fd6',
  teal: '#16C79A',
  ink: '#0A0A0A',
} as const;

// Soft blue → white wash used behind the marketing hero.
const PAGE_BG = 'linear-gradient(160deg,#eaf2ff 0%,#f4f8ff 40%,#ffffff 100%)';

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-block rounded-full border-2 border-black bg-white px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-neutral-900"
      style={{ boxShadow: '3px 3px 0 0 #000' }}
    >
      {children}
    </span>
  );
}

function BrutalBtn({
  children,
  type = 'button',
  onClick,
  disabled,
  color = 'blue',
  className = '',
}: {
  children: React.ReactNode;
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  color?: 'blue' | 'black' | 'white';
  className?: string;
}) {
  const bg = color === 'blue' ? BRAND.blue : color === 'black' ? BRAND.ink : '#ffffff';
  const fg = color === 'white' ? BRAND.blue : '#ffffff';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-[5px] border-[2.5px] border-black px-5 py-2.5 text-sm font-extrabold tracking-tight shadow-[4px_4px_0_0_#000] transition-all duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none disabled:pointer-events-none disabled:opacity-60 ${className}`}
      style={{ backgroundColor: bg, color: fg }}
    >
      {children}
    </button>
  );
}

function FullscreenSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

const ROLE_STYLE: Record<AccountWorkspace['role'], { label: MessageKey; badge: string }> = {
  owner: { label: 'admin.roleOwner', badge: 'border-2 border-black bg-amber-300 text-black' },
  admin: { label: 'admin.roleAdmin', badge: 'border-2 border-black bg-violet-300 text-black' },
  member: { label: 'admin.roleMember', badge: 'border-2 border-black bg-blue-200 text-black' },
  viewer: { label: 'admin.roleViewer', badge: 'border-2 border-black bg-zinc-200 text-black' },
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

// ---------------------------------------------------------------------------
// API credits campaign — "$X of $100 unlocked" checklist (official deployment
// only; the backend returns {enabled:false} on self-hosted builds).
// ---------------------------------------------------------------------------

const CAMPAIGN_MILESTONE_LABELS: Record<string, MessageKey> = {
  signup: 'campaign.msSignup',
  first_agent: 'campaign.msFirstAgent',
  first_conversation: 'campaign.msFirstConversation',
  second_agent: 'campaign.msSecondAgent',
  second_agent_response: 'campaign.msSecondAgentResponse',
};

const fmtUsd = (n: number) => (n % 1 ? n.toFixed(2) : String(n));

function CampaignCard({ idToken }: { idToken: string }) {
  const t = useT();
  const [status, setStatus] = useState<CampaignStatus | null>(null);
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCampaignStatus(idToken)
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => {}); // campaign is decorative — never surface errors here
    return () => { cancelled = true; };
  }, [idToken]);

  if (!status?.enabled) return null;

  if (status.requiresEmailVerification) {
    return (
      <div
        className="mt-10 rounded-2xl border-[2.5px] border-black bg-amber-50 p-6"
        style={{ boxShadow: '6px 6px 0 0 #000' }}
      >
        <h3 className="text-lg font-extrabold tracking-tight">{t('campaign.verifyTitle')}</h3>
        <p className="mt-1 text-sm text-neutral-700">{t('campaign.verifyBody', { email: status.email || '' })}</p>
      </div>
    );
  }

  const cap = status.capUsd ?? 100;
  const total = status.totalGrantedUsd ?? 0;
  const pct = Math.min(100, Math.round((total / cap) * 100));
  const key = status.apiKey || '';
  const maskedKey = key ? `${key.slice(0, 12)}…${key.slice(-4)}` : '';

  const copyKey = () => {
    navigator.clipboard.writeText(key);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  return (
    <div
      className="mt-10 rounded-2xl border-[2.5px] border-black bg-white p-6"
      style={{ boxShadow: '6px 6px 0 0 #000' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-extrabold tracking-tight">{t('campaign.homeTitle')}</h3>
          <p className="mt-0.5 text-sm text-neutral-600">
            {t('campaign.homeBody', { cap })}
          </p>
        </div>
        <div className="text-right">
          {/* Pilot Program credits stack on top of the $100 ladder: headline the
              real total on the key, and show the ladder-vs-cap as the sub-line —
              otherwise a pilot user reads "$60 / $100" and thinks $300 vanished. */}
          {status.pilot ? (
            <>
              <div className="text-2xl font-black tabular-nums">
                ${fmtUsd(status.grandTotalUsd ?? total + status.pilot.amountUsd)}
              </div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">{t('campaign.homeUnlocked')}</div>
              <div className="mt-0.5 text-[11px] font-semibold text-neutral-500">
                {t('campaign.homePilotLine', { total: fmtUsd(total), cap, pilot: fmtUsd(status.pilot.amountUsd) })}
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-black tabular-nums">
                ${fmtUsd(total)}
                <span className="text-sm font-bold text-neutral-400"> / ${cap}</span>
              </div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">{t('campaign.homeUnlocked')}</div>
            </>
          )}
        </div>
      </div>

      {/* progress bar */}
      <div className="mt-4 h-3 overflow-hidden rounded-full border-2 border-black bg-neutral-100">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${BRAND.blue}, ${BRAND.teal})` }}
        />
      </div>

      {/* milestones */}
      <ul className="mt-5 grid gap-2 sm:grid-cols-2">
        {(status.milestones || []).map((m) => {
          const done = !!m.grantedAt;
          return (
            <li key={m.key} className="flex items-center gap-2.5 text-sm">
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-black ${done ? 'text-neutral-950' : 'bg-white text-transparent'}`}
                style={done ? { backgroundColor: BRAND.teal } : undefined}
              >
                <Check className="size-3" strokeWidth={3.5} />
              </span>
              <span className={done ? 'font-semibold' : 'text-neutral-600'}>
                {CAMPAIGN_MILESTONE_LABELS[m.key] ? t(CAMPAIGN_MILESTONE_LABELS[m.key]) : m.key}
              </span>
              <span className={`ml-auto font-bold tabular-nums ${done ? '' : 'text-neutral-400'}`}>
                +${m.amountUsd}
              </span>
            </li>
          );
        })}
        <li className="flex items-center gap-2.5 text-sm">
          <span
            className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-black ${status.daily?.todayGranted ? 'text-neutral-950' : 'bg-white text-transparent'}`}
            style={status.daily?.todayGranted ? { backgroundColor: BRAND.teal } : undefined}
          >
            <Check className="size-3" strokeWidth={3.5} />
          </span>
          <span className={status.daily?.daysGranted ? 'font-semibold' : 'text-neutral-600'}>
            {t('campaign.homeDaily')}{status.daily?.daysGranted ? t('campaign.homeDailyProgress', { count: status.daily.daysGranted }) : ''}
          </span>
          <span className="ml-auto font-bold tabular-nums text-neutral-400">
            {t('campaign.homePerDay', { amount: status.daily?.grantUsd ?? 10 })}
          </span>
        </li>
      </ul>

      {/* API key */}
      {key && (
        <div className="mt-5 rounded-xl border-2 border-black bg-neutral-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-neutral-500">
              {t('campaign.keyTitle')}
            </span>
            <span className="text-[11px] text-neutral-400">
              {t('campaign.homeBaseUrl', { url: `${status.gatewayUrl}/v1` })}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={() => setKeyRevealed((v) => !v)}
              className="min-w-0 flex-1 truncate text-left font-mono text-[13px] hover:text-neutral-600"
              title={keyRevealed ? t('campaign.homeHideKey') : t('campaign.homeRevealKey')}
            >
              {keyRevealed ? key : maskedKey}
            </button>
            <button
              onClick={copyKey}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border-2 border-black bg-white transition-all hover:shadow-[2px_2px_0_0_#000]"
              title={t('campaign.homeCopyKey')}
            >
              {keyCopied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
            </button>
          </div>
          <p className="mt-2 text-[12px] text-neutral-500">
            {t('campaign.homeKeyHint')}
          </p>
        </div>
      )}
    </div>
  );
}

function WorkspaceTile({ workspace, highlight = false }: { workspace: AccountWorkspace; highlight?: boolean }) {
  const router = useRouter();
  const t = useT();
  const { timeAgo } = useFormatters();
  // Open by slug only — no token in the URL. The workspace page authenticates
  // the signed-in user and resolves the token from their account.
  const href = `/${workspace.slug}`;
  const gradient = TILE_GRADIENTS[hashString(workspace.slug) % TILE_GRADIENTS.length];
  const roleStyle = ROLE_STYLE[workspace.role];
  const role = roleStyle
    ? { label: t(roleStyle.label), badge: roleStyle.badge }
    : { label: workspace.role, badge: ROLE_STYLE.viewer.badge };

  return (
    <button
      onClick={() => router.push(href)}
      className="group relative text-left rounded-2xl border-[2.5px] border-black bg-white p-5 transition-all duration-100 hover:-translate-y-1 hover:shadow-[6px_6px_0_0_#000] focus:outline-none focus-visible:-translate-y-1 focus-visible:shadow-[6px_6px_0_0_#000]"
      style={highlight ? { boxShadow: `5px 5px 0 0 ${BRAND.teal}` } : undefined}
    >
      {highlight && (
        <span
          className="absolute -top-3 left-4 rounded-full border-2 border-black px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-neutral-950"
          style={{ backgroundColor: BRAND.teal }}
        >
          {t('dashboard.startHere')}
        </span>
      )}
      <div className="flex items-start gap-3">
        <div className={`size-11 shrink-0 rounded-xl border-2 border-black bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold`}>
          {initialsOf(workspace.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-extrabold tracking-tight text-neutral-900 truncate">{workspace.name}</h3>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${role.badge}`}>
              {role.label}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-500 font-mono">{workspace.slug}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-neutral-500">
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          {workspace.lastActivityAt ? timeAgo(workspace.lastActivityAt) : t('dashboard.noActivity')}
        </span>
        <span
          className="flex items-center gap-1 font-bold opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0"
          style={{ color: BRAND.blue }}
        >
          {t('common.open')} <ArrowRight className="size-3.5" />
        </span>
      </div>
    </button>
  );
}

function CreateTile({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      onClick={onClick}
      className="group flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-2xl border-[2.5px] border-dashed border-black bg-white/50 p-5 text-neutral-700 transition-all duration-100 hover:-translate-y-1 hover:bg-white hover:shadow-[6px_6px_0_0_#000] focus:outline-none focus-visible:-translate-y-1 focus-visible:shadow-[6px_6px_0_0_#000]"
    >
      <div className="flex size-11 items-center justify-center rounded-xl border-2 border-black">
        <Plus className="size-5" />
      </div>
      <span className="text-sm font-extrabold">{t('dashboard.newWorkspace')}</span>
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
  const t = useT();
  const [workspaces, setWorkspaces] = useState<AccountWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ErrorMessage | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const viewTrackedRef = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Network-level failures surface as the browser's raw fetch error
    // ("Failed to fetch" / "Load failed" / "NetworkError…") and are usually
    // transient — a rolling deploy, a flaky mobile/VPN hop, or a blocked
    // request. Retry with backoff before showing anything, and translate the
    // raw error into something actionable instead of leaving a cryptic
    // sticky banner over an empty workspace list.
    const backoffs = [0, 1500, 4000];
    let lastErr: unknown = null;
    for (const delay of backoffs) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        const list = await listAccountWorkspaces(idToken);
        setWorkspaces(list);
        // Funnel checkpoint: the signed-in user reached their workspace list
        // (which includes the auto-provisioned first workspace). Once per
        // visit — load() also reruns after create/delete.
        if (!viewTrackedRef.current) {
          viewTrackedRef.current = true;
          capture('membership_home_viewed', { workspace_count: list.length });
        }
        setLoading(false);
        return;
      } catch (err: unknown) {
        lastErr = err;
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : null;
    setError(
      msg === null
        ? { key: 'dashboard.loadFailed' }
        : /failed to fetch|load failed|networkerror/i.test(msg)
          ? { key: 'dashboard.networkError' }
          : { text: msg },
    );
    setLoading(false);
  }, [idToken]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const ws = await createAccountWorkspace(idToken, newName.trim() || 'Untitled workspace');
      group('workspace', ws.slug);
      capture('workspace_created', { source: 'membership_home', workspace_id: ws.slug });
      router.push(`/${ws.slug}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? { text: err.message } : { key: 'dashboard.createFailed' });
      setCreating(false);
    }
  };

  const openCreate = () => {
    setShowCreate(true);
    setNewName('');
  };

  // A lone owned workspace = the one we auto-provisioned at sign-up.
  const firstWorkspace =
    !loading && workspaces.length === 1 && workspaces[0].role === 'owner' ? workspaces[0] : null;

  // Single-workspace users go STRAIGHT IN — no picker, no "this is your first
  // workspace" card. A list with one option is pure friction (especially on a
  // phone). Once per browser session, so deliberately navigating back to the
  // home page still shows the list (rename/delete/create live here).
  const willAutoEnter =
    !!firstWorkspace &&
    typeof window !== 'undefined' &&
    sessionStorage.getItem('oa_auto_entered_first_ws') !== '1';
  const autoEnteredRef = useRef(false);
  useEffect(() => {
    if (!willAutoEnter || !firstWorkspace || autoEnteredRef.current) return;
    autoEnteredRef.current = true;
    sessionStorage.setItem('oa_auto_entered_first_ws', '1');
    capture('first_workspace_auto_entered', { workspace_id: firstWorkspace.slug });
    router.push(`/${firstWorkspace.slug}`);
  }, [willAutoEnter, firstWorkspace, router]);

  const handleSignOut = async () => {
    try {
      await onSignOut();
    } catch {
      /* already signed out */
    }
    // Also end the central openagents.org session — otherwise the login
    // redirect immediately re-authenticates and bounces back here. On localhost
    // there's no central login, so just fall through to the inline sign-in gate.
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && !desktopHost()) {
      window.location.href = 'https://openagents.org/logout';
    }
  };

  return (
    <div className="min-h-screen text-neutral-900" style={{ background: PAGE_BG }}>
      <header className="sticky top-0 z-10 border-b-2 border-black bg-white/85 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <a
            href="https://openagents.org"
            className="flex items-center gap-2.5 rounded-md transition-transform hover:-translate-y-0.5 focus:outline-none"
            title={t('dashboard.backToHome')}
          >
            <Image src="/logo-icon.png" alt="OpenAgents" width={26} height={26} />
            <span className="text-lg font-extrabold tracking-tight">OpenAgents</span>
          </a>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className="size-7 rounded-full border-2 border-black flex items-center justify-center text-white text-xs font-bold"
                style={{ background: `linear-gradient(135deg, ${BRAND.blue}, ${BRAND.teal})` }}
              >
                {(userEmail[0] || '?').toUpperCase()}
              </div>
              <span className="text-sm text-neutral-600 hidden sm:inline">{userEmail}</span>
            </div>
            <button
              onClick={handleSignOut}
              title={t('userMenu.signOut')}
              className="inline-flex size-8 items-center justify-center rounded-md border-2 border-black bg-white text-neutral-700 transition-all hover:bg-neutral-100 hover:shadow-[2px_2px_0_0_#000]"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* Hero */}
        <div className="mb-8">
          <Kicker>{t('dashboard.title')}</Kicker>
          <h1 className="mt-4 text-3xl sm:text-4xl font-black tracking-tight">{t('dashboard.heading')}</h1>
          <p className="mt-2 text-neutral-600">
            {t('dashboard.subtitle')}
            {!loading && workspaces.length > 0 && (
              <span className="text-neutral-400">
                {' '}· {t('dashboard.workspaceCount', { count: workspaces.length })}
              </span>
            )}
          </p>
        </div>

        {error && (
          <div
            className="mb-6 flex items-center justify-between gap-3 rounded-xl border-2 border-black bg-red-100 p-3 text-sm font-medium text-red-700"
            style={{ boxShadow: '3px 3px 0 0 #000' }}
          >
            <span>{'key' in error ? t(error.key) : error.text}</span>
            <button
              onClick={load}
              className="shrink-0 rounded-lg border-2 border-black bg-white px-3 py-1 text-xs font-bold text-black hover:bg-zinc-100 transition-colors"
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {showCreate && (
          <div
            className="mb-6 rounded-2xl border-[2.5px] border-black bg-white p-5"
            style={{ boxShadow: '6px 6px 0 0 #000' }}
          >
            <form onSubmit={handleCreate} className="space-y-3">
              <h3 className="font-extrabold tracking-tight">{t('dashboard.nameTitle')}</h3>
              <Input
                placeholder={t('dashboard.namePlaceholder')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                className="border-2 border-black focus-visible:border-black focus-visible:ring-0"
              />
              <div className="flex items-center gap-2">
                <BrutalBtn type="submit" disabled={creating} color="blue">
                  {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  {t('dashboard.createWorkspace')}
                </BrutalBtn>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="inline-flex items-center rounded-[5px] px-4 py-2.5 text-sm font-bold text-neutral-600 transition-colors hover:text-black"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        )}

        {loading || willAutoEnter ? (
          // Auto-entering renders the same skeleton as loading: the redirect
          // fires from the effect above, so the picker never flashes.
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[132px] rounded-2xl border-[2.5px] border-black bg-white/60 animate-pulse" />
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

        {/* API credits campaign checklist (renders nothing when disabled). */}
        <CampaignCard idToken={idToken} />
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
  const t = useT();
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || !!desktopHost());
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
    <div
      className="flex flex-col items-center justify-center min-h-screen gap-6 p-8 text-neutral-900"
      style={{ background: PAGE_BG }}
    >
      <div className="flex flex-col items-center gap-3">
        <Image src="/logo-icon.png" alt="OpenAgents" width={44} height={44} />
        <h1 className="text-2xl font-black tracking-tight">{t('auth.signInTitle')}</h1>
        <p className="text-neutral-600 text-sm text-center max-w-md">
          {t('auth.signInBody')}
        </p>
      </div>
      <BrutalBtn onClick={signIn} color="blue">
        {desktopHost() ? t('auth.signInTitle') : t('workspaceGate.signInWithGoogle')}
      </BrutalBtn>
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
