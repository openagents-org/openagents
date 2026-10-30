import { desktopHost } from './desktop-host';

// Central auth redirects for the workspace app.
//
// Login lives on openagents.org (not inline Firebase on the workspace origin),
// and logout must also end that central session — otherwise the login redirect
// immediately re-authenticates. These helpers keep every "sign in" / "sign out"
// entry point consistent. On localhost there's no central site, so we fall back
// to the app's own Firebase flow / a plain sign-out for local development.

const CENTRAL = 'https://openagents.org';

// NEXT_PUBLIC_INLINE_LOGIN=1 (build-time) makes every host behave like
// localhost: sign in with the app's own Firebase popup instead of bouncing
// through openagents.org. Invitation acceptance explicitly uses central login
// so every account provider is available and its return URL is preserved.
const INLINE_LOGIN = process.env.NEXT_PUBLIC_INLINE_LOGIN === '1';

function isLocalhost(): boolean {
  if (INLINE_LOGIN) return true;
  return typeof window !== 'undefined' && window.location.hostname === 'localhost';
}

/**
 * Send the user to the central login view. After they authenticate, it hands the
 * session back to this workspace and returns to where they started.
 * @param fallbackSignIn used only on localhost (inline Firebase Google popup).
 */
export function goToCentralLogin(fallbackSignIn?: () => void, options?: { forceCentral?: boolean }): void {
  if (typeof window === 'undefined') return;
  const host = desktopHost();
  if (host) { host.signIn(); return; }
  if (isLocalhost() && !options?.forceCentral) {
    fallbackSignIn?.();
    return;
  }
  const returnTo = encodeURIComponent(window.location.href);
  window.location.href = `${CENTRAL}/login?returnTo=${returnTo}`;
}

/**
 * Sign out on this origin, then end the central openagents.org session too and
 * land on the stable signed-out page (no auto re-login bounce).
 */
export async function goToCentralLogout(signOut: () => Promise<void>): Promise<void> {
  try {
    await signOut();
  } catch {
    /* already signed out */
  }
  if (typeof window === 'undefined' || isLocalhost() || desktopHost()) return;
  window.location.href = `${CENTRAL}/logout`;
}

/** Login route for protected pages; popup login must begin with a user click. */
export function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  if (desktopHost()) { desktopHost()?.signIn(); return; }
  if (isLocalhost() || window.location.hostname === 'workspace-preview.openagents.org') {
    const returnTo = window.location.pathname + window.location.search + window.location.hash;
    window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  } else {
    goToCentralLogin();
  }
}
