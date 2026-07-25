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
- **Rendering is off by default**: JS rendering returns `RENDER_DISABLED` unless
  `TRUSTED_BROWSER_EGRESS=1` is set. When disabled, `/v1/fetch` serves static
  content if it has it and otherwise reports `RENDER_DISABLED` — it does **not**
  steer the agent to the (equally unsafe) shared browser.
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
3. Only then set `TRUSTED_BROWSER_EGRESS=1`.

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
