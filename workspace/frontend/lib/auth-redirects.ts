// Central auth redirects for the workspace app.
//
// Login lives on openagents.org (not inline Firebase on the workspace origin),
// and logout must also end that central session — otherwise the login redirect
// immediately re-authenticates. These helpers keep every "sign in" / "sign out"
// entry point consistent. On localhost there's no central site, so we fall back
// to the app's own Firebase flow / a plain sign-out for local development.

const CENTRAL = 'https://openagents.org';

function isLocalhost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname === 'localhost';
}

/**
 * Send the user to the central login view. After they authenticate, it hands the
 * session back to this workspace and returns to where they started.
 * @param fallbackSignIn used only on localhost (inline Firebase Google popup).
 */
export function goToCentralLogin(fallbackSignIn?: () => void): void {
  if (typeof window === 'undefined') return;
  if (isLocalhost()) {
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
  if (typeof window === 'undefined' || isLocalhost()) return;
  window.location.href = `${CENTRAL}/logout`;
}
