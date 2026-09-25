// Workspace-issued login session — the Google-free path into the workspace.
//
// The normal login handoff turns openagents.org's Firebase custom token into a
// Firebase session in the browser (signInWithCustomToken) and keeps refreshing
// Firebase ID tokens. Both need Google's auth endpoints, which are blocked in
// mainland China, so those users could register but never get in. Instead the
// callback can hand the custom token to our own backend (POST /v1/auth/session),
// which performs the exchange server-side and returns a workspace session JWT.
// OIDC browser sessions use an HttpOnly cookie instead; only public metadata is
// restored into this module and API calls rely on credentialed cookies.

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://workspace-endpoint.openagents.org';
const STORAGE_KEY = 'oa_workspace_session';
const AUTH_CONFIG_TIMEOUT_MS = 5000;

export type AuthMode = 'workspace_token' | 'firebase' | 'oidc';

export interface PublicAuthConfig {
  mode: AuthMode;
  oidc: {
    enabled: boolean;
    providerName: string;
    configurationError: string | null;
  };
}

export async function fetchAuthConfig(): Promise<PublicAuthConfig> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_CONFIG_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}/v1/auth/config`, {
      cache: 'no-store',
      credentials: 'include',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Auth config failed (${response.status})`);
    const json = await response.json();
    return json.data as PublicAuthConfig;
  } finally {
    clearTimeout(timeout);
  }
}

export interface WorkspaceSession {
  token: string;
  email: string;
  displayName: string | null;
  /** Unix seconds. */
  expiresAt: number;
}

export interface OidcSession {
  email: string;
  displayName: string | null;
  /** Unix seconds. */
  expiresAt: number;
}

/** Exchange a login-handoff custom token for a workspace session (server-side). */
export async function exchangeHandoffToken(customToken: string): Promise<WorkspaceSession> {
  const res = await fetch(`${API_URL}/v1/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ custom_token: customToken }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.data?.session_token) {
    throw new Error(json?.message || `Sign-in failed (${res.status})`);
  }
  const session: WorkspaceSession = {
    token: json.data.session_token,
    email: json.data.email,
    displayName: json.data.display_name ?? null,
    expiresAt: Math.floor(new Date(json.data.expires_at).getTime() / 1000),
  };
  saveWorkspaceSession(session);
  return session;
}

export function saveWorkspaceSession(session: WorkspaceSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable (private mode quota) — session lives for this page only */
  }
}

/** The stored session, or null if absent, malformed, or within a minute of expiry. */
export function loadWorkspaceSession(): WorkspaceSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as WorkspaceSession;
    if (!s?.token || !s?.email || typeof s.expiresAt !== 'number') {
      clearWorkspaceSession();
      return null;
    }
    if (s.expiresAt - 60 < Date.now() / 1000) {
      clearWorkspaceSession();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function clearWorkspaceSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function fetchOidcSession(): Promise<OidcSession | null> {
  const response = await fetch(`${API_URL}/v1/auth/oidc/session`, {
    cache: 'no-store',
    credentials: 'include',
  });
  if (response.status === 401) return null;
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.data?.expires_at || typeof json.data.email !== 'string') {
    throw new Error(json?.message || `OIDC session failed (${response.status})`);
  }
  return {
    email: json.data.email,
    displayName: json.data.display_name || null,
    expiresAt: Math.floor(new Date(json.data.expires_at).getTime() / 1000),
  };
}

export async function endOidcSession(): Promise<string | null> {
  const response = await fetch(`${API_URL}/v1/auth/oidc/logout`, {
    method: 'POST',
    credentials: 'include',
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.message || `OIDC logout failed (${response.status})`);
  return json?.data?.logoutUrl || null;
}
