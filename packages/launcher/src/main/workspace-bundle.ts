import fs from "fs"
import path from "path"
import { app, protocol, session } from "electron"

import { slog } from "./bootstrap/startup-log"

/**
 * The workspace web app, served from inside the installer.
 *
 * The desktop build of `workspace/frontend` (see its vite.config.ts) is a
 * static bundle the launcher ships. It is served over a custom scheme rather
 * than loaded from `file:` for three reasons, all of which bite immediately:
 *
 *  - the pages reference assets by absolute path (`/logo-icon.png`), which on
 *    a file: URL resolves to the root of the disk
 *  - a file: page has an opaque origin, so localStorage and IndexedDB — which
 *    the workspace uses for its session and its caches — are unreliable
 *  - fetch() to the API needs an origin the server will accept
 *
 * Registered as `standard` and `secure`, this scheme behaves like https as far
 * as the web platform is concerned, while everything it serves comes off the
 * local disk.
 */

export const WORKSPACE_SCHEME = "openagents"
export const WORKSPACE_HOST = "workspace"

/**
 * The session the workspace runs in — its own, so its cookies and storage are
 * that app's rather than the launcher's, and signing out can wipe them without
 * touching anything the launcher keeps.
 *
 * It is also why the scheme handler below is registered against THIS session
 * and not through the global `protocol` module: that one only ever serves the
 * default session, and a view in another partition asking for the same scheme
 * gets ERR_FAILED with nothing to say why.
 */
export const WORKSPACE_PARTITION = "persist:workspace"

/** The URL for a route inside the bundle. Hash routing — see desktop/router. */
export function workspaceBundleUrl(route = "/"): string {
  const hash = route.startsWith("/") ? route : `/${route}`
  return `${WORKSPACE_SCHEME}://${WORKSPACE_HOST}/index.html#${hash}`
}

/**
 * Must run before `app.whenReady()`: Chromium reads this table when it sets up
 * the renderer's scheme registry, and a scheme registered later is treated as
 * an opaque one whatever the handler says.
 */
export function registerWorkspaceScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: WORKSPACE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ])
}

/**
 * Where the bundle lives.
 *
 * Packaged, it is an extraResource beside the app's code. In a dev checkout it
 * is the sibling package's build output, reached from more than one anchor
 * because `app.getAppPath()` is not the same directory under `electron-vite
 * dev` as it is elsewhere — and a wrong guess here shows up as an empty window
 * with nothing to explain it.
 */
export function bundleDir(): string {
  const candidates = [
    path.join(process.resourcesPath, "workspace"),
    path.join(app.getAppPath(), "..", "..", "workspace", "frontend", "dist-desktop"),
    path.join(app.getAppPath(), "..", "..", "..", "workspace", "frontend", "dist-desktop"),
    // From out/main/, where the compiled main process actually sits.
    path.join(__dirname, "..", "..", "..", "..", "workspace", "frontend", "dist-desktop"),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir
  }
  return candidates[0]
}

/** Whether a bundle is actually present — the app runs fine without one. */
export function bundleExists(): boolean {
  const dir = bundleDir()
  const present = fs.existsSync(path.join(dir, "index.html"))
  if (!present) slog(`[workspace-bundle] no bundle at ${dir}`)
  return present
}

/**
 * Serve the bundle. Called once, after the app is ready.
 *
 * Any path that is not a file falls back to index.html, the way a static host
 * would: the router is hash-based so this should not come up, but a bundle
 * that 404s its own entry point is a blank window with nothing to debug.
 */
/** Enough of a MIME table for what a Vite bundle contains. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
}

function contentType(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream"
}

export function serveWorkspaceBundle(): void {
  const root = bundleDir()
  const ses = session.fromPartition(WORKSPACE_PARTITION)
  ses.protocol.handle(WORKSPACE_SCHEME, async (request) => {
    const url = new URL(request.url)
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "")
    const target = path.join(root, relative || "index.html")

    // Nothing outside the bundle may be read, whatever the path claims.
    if (!target.startsWith(root)) {
      slog(`[workspace-bundle] refusing path outside the bundle: ${relative}`)
      return new Response("Not found", { status: 404 })
    }

    const hit = fs.existsSync(target) && fs.statSync(target).isFile()
    if (!hit) slog(`[workspace-bundle] no file for ${relative} — serving index`)
    const file = hit ? target : path.join(root, "index.html")
    try {
      // Read directly rather than through net.fetch(file://): one less layer
      // to be wrong about, and the content type is ours to state.
      return new Response(await fs.promises.readFile(file), {
        headers: { "content-type": contentType(file) },
      })
    } catch (err) {
      slog(`[workspace-bundle] read failed for ${file}: ${(err as Error).message}`)
      return new Response("Not found", { status: 404 })
    }
  })
  slog(`[workspace-bundle] serving ${root} on ${WORKSPACE_PARTITION}`)
}

/**
 * Let the bundled app talk to the workspace API.
 *
 * The API's CORS policy is an allowlist of the origins the WEB app is served
 * from. The bundle's origin is this custom scheme, which is on nobody's list,
 * so every request from it is refused at the preflight — the page loads and
 * then cannot fetch a thing.
 *
 * Two rewrites, confined to this session and to the API's own origin, because
 * the two ends of a CORS exchange are judged by different parties:
 *
 *  - outbound, the request presents the web origin the server already trusts,
 *    or the server refuses the preflight outright (400)
 *  - inbound, the server's `Access-Control-Allow-Origin` names that same web
 *    origin — but Chromium checks the reply against the origin that ACTUALLY
 *    made the request, which is still the bundle's, so the header has to be
 *    renamed back or every response is dropped as a CORS failure
 *
 * Doing only the first half is what shipped before, and it fails in the way
 * that is hardest to read: the page loads, every request goes out and comes
 * back 200, and the fetch still rejects with a bare `TypeError: Failed to
 * fetch` — which the workspace surfaces as "can't reach the server".
 *
 * `Access-Control-Allow-Credentials: true` is why the reply cannot simply say
 * `*`: with credentials allowed the wildcard is refused, so the header must
 * name this exact origin.
 *
 * This is a bridge, not the destination. The right fix is one entry in the
 * deployment's CORS_ORIGINS, after which this can go — it is written to be
 * removable without anything else changing.
 */
export function allowBundleApiAccess(apiOrigin: string, webOrigin: string): void {
  const ses = session.fromPartition(WORKSPACE_PARTITION)
  let announced = false

  ses.webRequest.onBeforeSendHeaders({ urls: [`${apiOrigin}/*`] }, (details, callback) => {
    const headers = { ...details.requestHeaders }
    // Only where there is one to replace: a request the page makes without an
    // Origin is not a CORS request, and adding one would make it into a
    // preflighted request that did not need to be.
    if (headers.Origin || headers.origin) {
      delete headers.origin
      headers.Origin = webOrigin
    }
    if (!announced) {
      announced = true
      slog(`[workspace-bundle] API bridge active — first call ${details.url}`)
    }
    callback({ requestHeaders: headers })
  })

  const bundleOrigin = `${WORKSPACE_SCHEME}://${WORKSPACE_HOST}`

  ses.webRequest.onHeadersReceived({ urls: [`${apiOrigin}/*`] }, (details, callback) => {
    const headers = { ...details.responseHeaders }
    // Header names arrive in whatever case the server sent them, and a
    // duplicate under a different case is itself a CORS failure — so clear
    // every spelling before writing the one that counts.
    for (const name of Object.keys(headers)) {
      const lower = name.toLowerCase()
      if (
        lower === "access-control-allow-origin" ||
        lower === "access-control-allow-credentials"
      ) {
        delete headers[name]
      }
    }
    headers["access-control-allow-origin"] = [bundleOrigin]
    // Restored alongside the origin: the page sends a bearer, not a cookie, so
    // this changes nothing about what is sent — but dropping a header the
    // server set would be a silent behaviour change of its own.
    headers["access-control-allow-credentials"] = ["true"]
    callback({ responseHeaders: headers })
  })
}
