import { net } from "electron"

/**
 * The account layer's HTTP, on Electron's network stack rather than Node's.
 *
 * `net.fetch` goes through Chromium, which means it honours the proxy the app
 * is configured with (Settings → proxy, or the system one Electron adopts on
 * its own) and the certificate store that comes with it. The global `fetch` is
 * undici: it reads neither, and would go direct on exactly the machines where
 * direct does not work.
 *
 * That gap is not hypothetical here. The embedded workspace view IS Chromium,
 * so on a proxied machine the page would load while every account request beside
 * it failed — a signed-out launcher in front of a signed-in workspace, with
 * nothing on screen to explain the difference. Reaching Google for the sign-in
 * fallback has the same problem, more sharply.
 *
 * Falls back to the global fetch where `net` is absent, which outside Electron
 * (the unit tests) is the only thing there is.
 */
export function authFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const electronFetch = (net as { fetch?: typeof fetch } | undefined)?.fetch
  return electronFetch ? electronFetch(url, init) : fetch(url, init)
}
