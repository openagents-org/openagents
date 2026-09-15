const HOSTED_ORIGIN = 'https://workspace.openagents.org';

/**
 * The origin a link has to carry to open anywhere but this page — a QR code a
 * phone scans, a share link pasted into a chat.
 *
 * `window.location.origin` is that origin on every real deployment, with two
 * exceptions. On localhost no phone can reach it. In the launcher the bundled
 * build is served from `openagents://workspace`, a scheme nothing outside the
 * desktop app understands — a QR code carrying it scans as "no usable data".
 * The launcher's preload hands over the real web origin as `__OA_WEB_URL__`;
 * without one, fall back to the hosted app, the same localhost carve-out
 * `lib/auth-redirects.ts` makes.
 */
export function shareOrigin(): string {
  if (typeof window === 'undefined') return HOSTED_ORIGIN;
  const { protocol, hostname, origin } = window.location;
  const isWeb = protocol === 'https:' || protocol === 'http:';
  if (isWeb && hostname !== 'localhost') return origin;
  const desktop = (window as unknown as { __OA_WEB_URL__?: string }).__OA_WEB_URL__;
  return desktop ? desktop.replace(/\/$/, '') : HOSTED_ORIGIN;
}
