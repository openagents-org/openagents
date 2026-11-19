import { getApiBaseUrl } from '@/lib/api-base';
import { backendErrorMessage } from '@/lib/account-api';
import { saveWorkspaceSession, type WorkspaceSession } from '@/lib/workspace-session';

// Self-hosted email/password accounts (backend: /v1/auth/local/*).
//
// A successful sign-in returns the same workspace session JWT the hosted
// handoff exchange issues (lib/workspace-session), so the rest of the app —
// the Bearer identity, Membership Home, workspace gates — treats a local
// account exactly like any other workspace session.

export const MIN_PASSWORD_LENGTH = 8;

/** A failed local-auth call: the HTTP status plus the server's message. */
export class LocalAuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'LocalAuthError';
    this.status = status;
  }
}

async function post(path: string, body: unknown, bearer?: string): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new LocalAuthError(res.status, backendErrorMessage(json, res.status));
  return { status: res.status, json };
}

/** Turn a session payload into a stored WorkspaceSession. */
export function sessionFromPayload(json: unknown): WorkspaceSession {
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data.session_token !== 'string' || typeof data.email !== 'string') {
    throw new LocalAuthError(0, 'The server did not return a session');
  }
  const expires = typeof data.expires_at === 'string' ? new Date(data.expires_at).getTime() : NaN;
  return {
    token: data.session_token,
    email: data.email,
    displayName: typeof data.display_name === 'string' && data.display_name ? data.display_name : null,
    // A missing/unparseable expiry: assume a day rather than "already expired".
    expiresAt: Math.floor((Number.isFinite(expires) ? expires : Date.now() + 86_400_000) / 1000),
  };
}

function store(json: unknown): WorkspaceSession {
  const session = sessionFromPayload(json);
  saveWorkspaceSession(session);
  return session;
}

export async function localLogin(email: string, password: string): Promise<WorkspaceSession> {
  return store((await post('/v1/auth/local/login', { email, password })).json);
}

export async function localSignup(input: {
  email: string;
  password: string;
  displayName?: string;
  inviteToken?: string | null;
}): Promise<WorkspaceSession> {
  const body: Record<string, string> = { email: input.email, password: input.password };
  if (input.displayName?.trim()) body.display_name = input.displayName.trim();
  if (input.inviteToken) body.invite_token = input.inviteToken;
  return store((await post('/v1/auth/local/signup', body)).json);
}

export async function changeLocalPassword(bearer: string, currentPassword: string, newPassword: string): Promise<void> {
  await post('/v1/auth/local/password', { current_password: currentPassword, new_password: newPassword }, bearer);
}

export async function requestPasswordReset(email: string): Promise<void> {
  await post('/v1/auth/local/reset/request', { email });
}

export async function resetPassword(token: string, newPassword: string): Promise<WorkspaceSession> {
  return store((await post('/v1/auth/local/reset', { token, new_password: newPassword })).json);
}

/** Only same-origin application paths may be used as a post-login destination. */
export function safeReturnTo(target: string | null | undefined): string {
  const t = target || '/';
  if (!t.startsWith('/') || t.startsWith('//') || t.includes('\\')) return '/';
  if (t.startsWith('/login') || t.startsWith('/reset-password')) return '/';
  return t;
}

/** The invitation a login was reached for: `?invite=<token>`, or a returnTo of `/invite/<token>`. */
export function inviteTokenFrom(params: { get(name: string): string | null }): string | null {
  const direct = params.get('invite');
  if (direct) return direct;
  const returnTo = params.get('returnTo') || '';
  const m = returnTo.match(/^\/invite\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export type LocalAuthForm = 'signin' | 'signup' | 'forgot';

/** Client-side checks before a request; returns an i18n key or null. */
export function validateLocalAuthForm(
  form: LocalAuthForm,
  values: { email: string; password: string; confirm?: string },
): 'localAuth.emailRequired' | 'localAuth.passwordRequired' | 'localAuth.passwordTooShort' | 'localAuth.passwordMismatch' | null {
  const email = values.email.trim();
  if (!email || !email.includes('@')) return 'localAuth.emailRequired';
  if (form === 'forgot') return null;
  if (!values.password) return 'localAuth.passwordRequired';
  if (form === 'signup') {
    if (values.password.length < MIN_PASSWORD_LENGTH) return 'localAuth.passwordTooShort';
    if (values.confirm !== undefined && values.confirm !== values.password) return 'localAuth.passwordMismatch';
  }
  return null;
}

/** Map a failed call to a user-facing i18n key (null: show the server's own message). */
export function localAuthErrorKey(form: LocalAuthForm | 'reset' | 'change', err: unknown):
  | 'localAuth.invalidCredentials' | 'localAuth.throttled' | 'localAuth.accountExists' | 'localAuth.signupClosed'
  | 'localAuth.resetInvalid' | 'localAuth.wrongCurrent' | null {
  if (!(err instanceof LocalAuthError)) return null;
  if (err.status === 429) return 'localAuth.throttled';
  if (form === 'change' && (err.status === 401 || err.status === 403)) return 'localAuth.wrongCurrent';
  if (form === 'reset' && [400, 401, 404, 410].includes(err.status)) return 'localAuth.resetInvalid';
  if (form === 'signin' && err.status === 401) return 'localAuth.invalidCredentials';
  // 409 covers both "account exists" and "this address needs its invite link";
  // the server's message tells them apart, so prefer it when there is one.
  const generic = err.message.startsWith('API error');
  if (form === 'signup' && err.status === 409) return generic ? 'localAuth.accountExists' : null;
  if (form === 'signup' && err.status === 403) return generic ? 'localAuth.signupClosed' : null;
  return null;
}
