import { getApiBaseUrl } from '@/lib/api-base';

// Runtime auth mode.
//
// The hosted app (workspace.openagents.org) signs people in through the
// central openagents.org login and Firebase. A self-hosted instance has
// neither: its backend runs its own email/password accounts and says so at
// GET /v1/auth/config. One frontend build serves both, so the mode is decided
// at runtime:
//
//   hosted — first-party host: central login + Firebase (unchanged behaviour)
//   local  — backend reports local_auth: login-gated, local /login, no
//            Firebase, never a redirect to openagents.org
//   none   — any other host: no human login, `?token=` workspace links only
//
// The config is fetched at most once per page. Any failure (old backend
// without the endpoint, network error, timeout) means "not local", so the
// hosted app keeps behaving exactly as before.

export type AuthMode = 'hosted' | 'local' | 'none';

export interface AuthConfig {
  localAuth: boolean;
  signupOpen: boolean;
  emailEnabled: boolean;
  providers: string[];
}

/** The production hosts: always hosted, so they never wait on the config call. */
export const HOSTED_PRODUCTION_HOSTNAMES = ['workspace.openagents.org', 'workspace-preview.openagents.org'];

const CONFIG_TIMEOUT_MS = 4000;

let configPromise: Promise<AuthConfig | null> | null = null;

export function parseAuthConfig(json: unknown): AuthConfig | null {
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== 'object') return null;
  return {
    localAuth: data.local_auth === true,
    signupOpen: data.signup_open === true,
    emailEnabled: data.email_enabled === true,
    providers: Array.isArray(data.providers) ? data.providers.filter((p): p is string => typeof p === 'string') : [],
  };
}

/** GET /v1/auth/config, cached for the page's lifetime. Resolves null on any failure. */
export function fetchAuthConfig(): Promise<AuthConfig | null> {
  if (!configPromise) {
    configPromise = (async () => {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => controller?.abort(), CONFIG_TIMEOUT_MS);
      try {
        const res = await fetch(`${getApiBaseUrl()}/v1/auth/config`, {
          cache: 'no-store',
          signal: controller?.signal,
        });
        if (!res.ok) return null;
        return parseAuthConfig(await res.json().catch(() => null));
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    })();
  }
  return configPromise;
}

/** Test hook: forget the cached config. */
export function resetAuthConfigCache(): void {
  configPromise = null;
}

/**
 * Decide the mode from the host and the backend config.
 * @param firstParty whether the hostname is one of the app's own hosts
 *   (OPENAGENTS_HOSTNAMES — including localhost and NEXT_PUBLIC_FIRST_PARTY_HOSTNAMES).
 */
export function resolveAuthMode(opts: {
  hostname: string;
  firstParty: boolean;
  desktop: boolean;
  config: AuthConfig | null;
}): AuthMode {
  // Production hosts are hosted by definition. The desktop launcher owns its
  // session, so it keeps the host-based decision it always had.
  if (HOSTED_PRODUCTION_HOSTNAMES.includes(opts.hostname)) return 'hosted';
  if (!opts.desktop && opts.config?.localAuth) return 'local';
  return opts.firstParty ? 'hosted' : 'none';
}

/** Whether resolving the mode for this host needs the backend config at all. */
export function needsAuthConfig(hostname: string, desktop: boolean): boolean {
  return !desktop && !HOSTED_PRODUCTION_HOSTNAMES.includes(hostname);
}

// The resolved mode, for plain modules (auth-redirects) that cannot use hooks.
// Set by OpenAgentsAuthProvider once resolved.
let currentMode: AuthMode | null = null;

export function setCurrentAuthMode(mode: AuthMode | null): void {
  currentMode = mode;
}

export function isLocalAuthMode(): boolean {
  return currentMode === 'local';
}
