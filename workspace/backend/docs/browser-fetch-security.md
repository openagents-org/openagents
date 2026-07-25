# Browser & Fetch — security posture and pre-launch checklist

The workspace can fetch and render arbitrary agent/user-supplied URLs
(`/v1/fetch`, `/v1/files/from_url`, and the shared browser). Those URLs are
**untrusted**, so this subsystem is an SSRF surface. This note records what the
code already enforces and what still MUST be done at the infrastructure level
before enabling rendering in an untrusted deployment.

## What the code enforces

- **SSRF-safe outbound fetch** (`app/net_security.py`): scheme allowlist, reject
  embedded credentials, resolve every hostname and require all IPs to be public
  (blocks loopback/private/link-local/reserved/multicast and IPv4-mapped IPv6),
  re-validate every redirect hop, `trust_env=False`, streamed byte cap, and the
  connection is **pinned to a validated IP** (via httpcore `sni_hostname`) so the
  DNS-rebinding window between validation and connect is closed. Covered by unit
  tests plus a real local-TLS integration test (`tests/test_pinned_tls.py`).
- **Browser navigation guarding**: `open_tab`, `navigate` and the render path
  validate the entry URL and block private hosts (`BLOCKED_PRIVATE_ADDRESS`).
  Local Playwright pages install a `page.route` guard that aborts any request
  (main navigation, redirects, XHR, sub-resources) to a non-public host and
  allows only `data:`/`blob:`/`about:` non-http schemes.
- **Browsing is off by default, per surface**: both JS rendering AND the shared
  browser (`open_tab`/`navigate`) fail closed unless the surface that actually
  runs the navigation is trusted. The two surfaces have separate gates because
  they run in different networks:
  - `TRUSTED_LOCAL_BROWSER_EGRESS=1` — local Playwright runs on this host.
  - `TRUSTED_BF_EGRESS=1` — Browser Fabric runs in BF's network.
  - `TRUSTED_BROWSER_EGRESS=1` — umbrella flag enabling both (back-compat).

  When rendering is disabled, `/v1/fetch` reports `RENDER_DISABLED` (with the
  partial static text clearly labeled, never masqueraded as a successful fetch)
  and does **not** steer the agent to the shared browser. The shared-browser
  routes return `BROWSER_DISABLED` (HTTP 403). Only `http(s)` and `about:blank`
  are accepted; `file://`/`ftp://`/`ws://` etc. are rejected (`UNSUPPORTED_SCHEME`).
- **Per-worker render concurrency cap** (`RENDER_MAX_CONCURRENCY`) so a burst of
  fetches can't exhaust BrowserFabric concurrency/cost on one worker.

## Why the code alone is not sufficient

`page.route` is defense-in-depth only. Per Playwright's docs it does not
intercept every Service Worker request, and WebSockets need a separate routing
API. A headless browser can also be steered to internal addresses in ways the
application layer can't fully see. The real boundary is the network.

## Pre-launch requirements (MUST do before setting `TRUSTED_BROWSER_EGRESS=1`)

1. **Container/pod private-egress deny.** Block the browser's egress to
   RFC1918, loopback, link-local (`169.254.0.0/16`, incl. cloud metadata),
   and other internal ranges at the network layer (egress firewall / NetworkPolicy /
   dedicated egress proxy). This is what actually stops rebinding and
   Service-Worker/WebSocket SSRF.
2. **Browser Fabric isolation guarantee.** Confirm in writing that BF sessions
   cannot reach BF's own internal network / metadata / localhost. Until then,
   treat cloud render as untrusted and keep it disabled (or behind a per-workspace
   allowlist) for untrusted URLs.
3. Only then set the matching flag(s): `TRUSTED_LOCAL_BROWSER_EGRESS=1` once (1)
   is done for this host, `TRUSTED_BF_EGRESS=1` once (2) is confirmed. Enabling a
   surface is a security decision and a behavior change (the shared browser is
   off until enabled) — it needs explicit sign-off, not a silent default.

## Follow-ups tracked for launch (not blocking the code changes here)

- **Distributed render metering.** `RENDER_MAX_CONCURRENCY` is per-worker; a
  cross-worker cap / cost budget needs a shared store (DB counter — Redis is
  intentionally avoided in this project). Add before high-volume launch.
- **`live_url` heartbeat.** A human operating a shared tab through the BF live
  view does not hit our backend, so the idle reaper can close a tab someone is
  actively using. Add a heartbeat from the live-view iframe, or (interim) extend
  / pause the reaper TTL for tabs that expose a `live_url`.
- **Postgres dual-session test** for the settings-PATCH row lock and the tab
  quota/reaper claims. SQLite can't exercise `FOR UPDATE` / `SKIP LOCKED`
  concurrency; add a Postgres-backed concurrency test in CI.
