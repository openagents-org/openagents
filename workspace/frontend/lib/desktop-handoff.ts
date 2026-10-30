// Login handoff for the desktop launcher.
//
// The launcher signs people in on this site's own pages, in a view inside the
// app — so the ordinary flow (central login → /auth/callback → back here) is
// what runs, and there is nothing desktop-specific about it except one thing:
// the session has to be one the app can KEEP. A Firebase session lives in the
// page; a workspace session (POST /v1/auth/session) is 30 days, minted
// server-side, and readable by the app that hosts the view. So a sign-in
// recognised as the launcher's takes that exchange first, wherever it happens.
//
// The loopback half below is for the accounts that cannot sign in inside an
// app at all: Google and GitHub refuse to authenticate in an embedded view, so
// those go out to the real browser, which has no way back into the app except
// a port it can post to.
//
// The launcher opens /auth/desktop?port=&state= here. That page is an ordinary
// page on this origin, which matters: the central login treats `returnTo` as
// the destination to land on AFTER it has minted a custom token and bounced
// through /auth/callback, so pointing returnTo at the callback itself skips the
// token entirely. Landing on a normal page keeps the whole flow on the path the
// web app already uses every day.
//
// What travels to the launcher is a workspace session (POST /v1/auth/session):
// 30 days, minted server-side, no Google round-trip — so the desktop app stays
// signed in, mainland China included. A Firebase ID token would not do: it
// lapses in an hour and its refresh token never leaves the browser.

export interface DesktopHandoff {
  port: number;
  state: string;
}

/** Where the launcher sends people to start a browser sign-in. */
export const DESKTOP_AUTH_PATH = '/auth/desktop';

/**
 * The user agent the desktop app appends to this view's own (see the launcher's
 * workspace-host). Present only inside the app, never in a browser.
 */
const LAUNCHER_UA_TAG = 'OpenAgentsLauncher';

/** Whether this page is running inside the desktop app's own view. */
export function isLauncherView(): boolean {
  return (
    typeof navigator !== 'undefined' && navigator.userAgent.includes(LAUNCHER_UA_TAG)
  );
}

/**
 * Whether the sign-in in progress belongs to the desktop app — either because
 * it is happening inside it, or because it is a browser round trip on its
 * behalf. Both need the session the app can keep.
 */
export function isDesktopSignIn(returnTo: string | null): boolean {
  return isLauncherView() || isDesktopReturn(returnTo);
}

/** Anything above the privileged range; the launcher binds an ephemeral port. */
const MIN_PORT = 1024;
const MAX_PORT = 65535;

/** Read the loopback target out of /auth/desktop's own query. */
export function parseDesktopHandoff(search: string): DesktopHandoff | null {
  const params = new URLSearchParams(search);
  const port = Number(params.get('port'));
  const state = params.get('state');
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) return null;
  if (!state) return null;
  return { port, state };
}

/**
 * Whether a login handoff is on its way back to the desktop app.
 *
 * The callback page asks this: a sign-in bound for the launcher must be
 * exchanged server-side for a workspace session even where Firebase is
 * perfectly reachable, because that is the only credential the app can keep.
 *
 * Same-origin is part of the question, not a detail: this answer decides that
 * the callback may redirect straight to `returnTo`, and a path check alone
 * would take https://elsewhere.example/auth/desktop for our own page.
 */
export function isDesktopReturn(returnTo: string | null): boolean {
  if (!returnTo) return false;
  try {
    const url = new URL(returnTo, window.location.origin);
    return url.origin === window.location.origin && url.pathname === DESKTOP_AUTH_PATH;
  } catch {
    return false;
  }
}

interface ForwardPayload {
  state: string;
  session?: { token: string; email: string; displayName: string | null; expiresAt: number };
  error?: string;
}

/**
 * Hand the session to the launcher's loopback listener.
 *
 * A cross-origin POST it can read (the listener answers with our origin in
 * Access-Control-Allow-Origin, and grants the private-network access Chrome
 * requires of a public page reaching 127.0.0.1). Where the browser refuses that
 * outright, fall back to navigating to the same endpoint with the payload in
 * the query — a sign-in that completes beats one that is tidy.
 */
export async function forwardToDesktop(
  handoff: DesktopHandoff,
  payload: Omit<ForwardPayload, 'state'>,
): Promise<void> {
  const url = `http://127.0.0.1:${handoff.port}/desktop-auth`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: handoff.state, ...payload }),
    });
    if (!res.ok) throw new Error(`Launcher refused the sign-in (${res.status})`);
  } catch {
    const query = new URLSearchParams({ state: handoff.state });
    if (payload.session) {
      query.set('session_token', payload.session.token);
      query.set('email', payload.session.email);
      if (payload.session.displayName) query.set('display_name', payload.session.displayName);
      query.set('expires_at', String(payload.session.expiresAt));
    }
    if (payload.error) query.set('error', payload.error);
    window.location.replace(`${url}?${query.toString()}`);
  }
}
