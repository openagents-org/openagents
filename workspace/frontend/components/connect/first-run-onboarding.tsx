'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Check, Loader2, RotateCcw } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { workspaceApi } from '@/lib/api';
import { desktopHost } from '@/lib/desktop-host';
import { DesktopComputerStep } from './desktop-computer-step';
import { OnboardingPairingPanel } from './onboarding-pairing-panel';
import { SetupEmailButton } from './setup-email-button';
import { OnboardingConnectionHero } from './onboarding-connection-hero';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { getAccountProfile, updateAccountProfile } from '@/lib/account-api';
import type { PairingCode } from '@/lib/types';
import dynamic from 'next/dynamic';
import { ConnectAgentView } from './connect-agent-view';

const WelcomeFilm = dynamic(() => import('./welcome-film'), { ssr: false });

// ---------------------------------------------------------------------------
// First-run onboarding — a brand-new workspace (no agents, no nodes) goes
// straight to connecting a device: the pairing code is minted and shown
// immediately (manual connection is being retired, so there is no "choose your
// path" step anymore). Cloud agents — and, for now, the manual flow — remain
// reachable via a small note under the pairing panel.
// ---------------------------------------------------------------------------

// Once per ACCOUNT (server flag), with localStorage as the fast path and the
// logged-out/self-hosted fallback: a phone user who later opens their laptop
// must not sit through the film twice, and a replay must not depend on which
// browser they happen to be in.
const WELCOME_FILM_SEEN_KEY = 'oa:welcomeFilmSeen';

export function FirstRunOnboarding({ onDismiss }: { onDismiss?: () => void } = {}) {
  const t = useT();
  const isDesktop = desktopHost() !== null;
  const { idToken: welcomeIdToken } = useOpenAgentsAuth();
  const [welcomeDone, setWelcomeDone] = useState(
    () => typeof window === 'undefined' || localStorage.getItem(WELCOME_FILM_SEEN_KEY) === '1',
  );

  // Account-level check: another device may already have played the intro.
  // The film starts optimistically; if the server says "seen", end it quietly.
  useEffect(() => {
    if (welcomeDone || !welcomeIdToken) return;
    let cancelled = false;
    getAccountProfile(welcomeIdToken)
      .then((p) => {
        if (cancelled || !p.welcomeSeen) return;
        try { localStorage.setItem(WELCOME_FILM_SEEN_KEY, '1'); } catch { /* private mode */ }
        setWelcomeDone(true);
      })
      .catch(() => { /* offline/legacy backend — browser flag still applies */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welcomeIdToken]);

  const finishWelcome = useCallback((skipped: boolean) => {
    try { localStorage.setItem(WELCOME_FILM_SEEN_KEY, '1'); } catch { /* private mode */ }
    if (welcomeIdToken) {
      updateAccountProfile(welcomeIdToken, { welcomeSeen: true }).catch(() => {});
    }
    setWelcomeDone(true);
  }, [welcomeIdToken]);

  // Value first: three pillar slides (hub → collaboration → humans+agents)
  // play full screen before any ask (download, pairing). Each slide animates
  // once and holds its closing frame; the user pages with prev/next, the last
  // slide's CTA — or skipping at any point — drops into the pairing step.
  // On phones the slides letterbox like any landscape video and the controls
  // keep full-size touch targets.
  if (!welcomeDone) {
    return (
      // fixed, not h-full: the intro owns the entire viewport, covering the
      // nav rail / header (desktop) and header / tab bar (mobile) alike.
      <div className="fixed inset-0 z-[100] overflow-hidden bg-white">
        <WelcomeFilm
          embedded
          onEnded={() => finishWelcome(false)}
          onSkip={() => finishWelcome(true)}
          skipLabel={t('onboarding.skipIntro')}
          ctaLabel={t('onboarding.getStarted')}
        />
      </div>
    );
  }

  const footer = (
    <div className="pt-4 text-center">
      <button
        onClick={() => {
          setWelcomeDone(false);
        }}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <RotateCcw className="size-3.5" />{t('onboarding.replayIntro')}
      </button>
    </div>
  );
  return isDesktop
    ? <NodeOnboardingStep onDismiss={onDismiss} footer={footer} />
    : <ConnectAgentView autoPair onDismiss={onDismiss} footer={footer} />;
}

/** Bottom progress indicator for the onboarding flow. */
function OnboardingSteps({ current, thisComputer = false }: { current: number; thisComputer?: boolean }) {
  const t = useT();
  // Two steps since the "choose your path" screen was retired: the flow goes
  // straight to the pairing code.
  const steps = [
    t(thisComputer ? 'onboarding.connectThisComputer' : 'onboarding.stepperConnect'),
    t('onboarding.stepperStart'),
  ];
  return (
    <div className="shrink-0 border-t py-4 px-6">
      <div className="flex items-center justify-center gap-2 max-w-md mx-auto">
        {steps.map((label, i) => {
          const n = i + 1;
          const active = n === current;
          const done = n < current;
          return (
            <div key={label} className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'size-6 rounded-full flex items-center justify-center text-xs font-semibold',
                  active ? 'bg-primary text-primary-foreground'
                    : done ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}>
                  {done ? <Check className="size-3.5" /> : n}
                </span>
                <span className={cn('text-xs font-medium hidden sm:inline', active ? 'text-foreground' : 'text-muted-foreground')}>
                  {label}
                </span>
              </div>
              {n < steps.length && <span className="w-6 h-px bg-border" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Onboarding step 2 — connect a node. A focused view: just the pairing code,
 * install options, and the live "waiting" indicator (no tabs, no empty state).
 * Once a device connects it advances to step 3 (add an agent).
 */
function NodeOnboardingStep({ footer, onDismiss }: { footer?: React.ReactNode; onDismiss?: () => void }) {
  const host = desktopHost();
  const { workspace } = useWorkspace();
  const { connectSetupRequest } = useLayout();
  const [otherDevice, setOtherDevice] = useState(connectSetupRequest?.method === 'terminal');
  const appliedLocationRequest = useRef(connectSetupRequest);
  useEffect(() => {
    if (connectSetupRequest && connectSetupRequest !== appliedLocationRequest.current) {
      appliedLocationRequest.current = connectSetupRequest;
      setOtherDevice(connectSetupRequest.method === 'terminal');
    }
  }, [connectSetupRequest]);
  const [connectedNodeId, setConnectedNodeId] = useState<string | null>(null);
  // Older preload versions can briefly coexist with an updated bundle in dev.
  if (!host?.getComputerStatus || !workspace) return <RemoteNodeOnboardingStep footer={footer} onBack={onDismiss} />;
  if (connectedNodeId) return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-hidden"><ConnectAgentView initialTab="node" autoAddAgent preferredNodeId={connectedNodeId} /></div>
      <OnboardingSteps current={2} thisComputer />
    </div>
  );
  if (otherDevice) return <RemoteNodeOnboardingStep onBack={() => setOtherDevice(false)} footer={footer} requireNewNode />;
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-10">
          <DesktopComputerStep key={workspace.workspaceId} host={host} workspaceId={workspace.workspaceId} workspaceName={workspace.name}
            onConnected={setConnectedNodeId} onOtherDevice={() => setOtherDevice(true)} />
          {footer}
        </div>
      </div>
      <OnboardingSteps current={1} />
    </div>
  );
}

function RemoteNodeOnboardingStep({ onBack, footer, requireNewNode = false }: { onBack?: () => void; footer?: React.ReactNode; requireNewNode?: boolean }) {
  const t = useT();
  const { workspace } = useWorkspace();
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectedNodeId, setConnectedNodeId] = useState<string>();
  const [errored, setErrored] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const baselineRef = useRef<Set<string>>(new Set());

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const code = await workspaceApi.createPairingCode();
      setPairing(code);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(/40[13]/.test(msg) ? t('connect.nodePairingForbidden') : t('connect.nodePairingFailed'));
    } finally {
      setRegenerating(false);
    }
  };

  // On mount: snapshot existing nodes, then either jump to step 3 (a node is
  // already here) or mint a pairing code.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ns = await workspaceApi.listNodes();
        if (cancelled) return;
        baselineRef.current = new Set(ns.map((n) => n.nodeId));
        if (ns.length > 0 && !requireNewNode) { setConnected(true); return; }
        const code = await workspaceApi.createPairingCode();
        if (!cancelled) {
          setPairing(code);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : '';
        toast.error(/40[13]/.test(msg) ? t('connect.nodePairingForbidden') : t('connect.nodePairingFailed'));
        setErrored(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll for a newly connected device while waiting.
  useEffect(() => {
    if (connected) return;
    const id = setInterval(async () => {
      try {
        const ns = await workspaceApi.listNodes();
        const added = ns.find((n) => !baselineRef.current.has(n.nodeId) && n.status === 'online');
        if (added) {
          setConnectedNodeId(added.nodeId);
          setConnected(true);
          toast.success(t('connect.nodeConnectedToast'));
        }
      } catch { /* transient */ }
    }, 3000);
    return () => clearInterval(id);
  }, [connected, t]);

  // Step 3 — the device is connected; hand off to the connect view to add an
  // agent, keeping the step indicator pinned below.
  if (connected) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 min-h-0 overflow-hidden">
          <ConnectAgentView initialTab="node" autoAddAgent preferredNodeId={connectedNodeId} />
        </div>
        <OnboardingSteps current={2} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <OnboardingConnectionHero workspaceName={workspace?.name || t('nav.workspaceFallback')} onBack={onBack} />

        <div id="onboarding-device-setup" className="mx-auto w-full max-w-3xl scroll-mt-8 space-y-6 px-4 py-6 sm:px-6 sm:py-7">

          {pairing ? (
            <OnboardingPairingPanel pairing={pairing} onDismiss={onBack} onRegenerate={regenerate} regenerating={regenerating} />
          ) : errored ? (
            <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
              {t('connect.nodePairingFailed')}
            </div>
          ) : (
            <div className="flex items-center justify-center py-14 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}

          <SetupEmailButton />

          {footer}
        </div>
      </div>
      <OnboardingSteps current={1} />
    </div>
  );
}
