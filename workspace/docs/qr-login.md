# QR-code login

Sign in on a computer by scanning a code with the OpenAgents app on a phone that is already signed in, as in WeChat and Lark. The computer is either the workspace web app or the desktop app.

The feature is **hidden** until the mobile app can scan. Turn it on for testing:

- **Web**: open any workspace page with `?qr_login=1` (for example `https://workspace.openagents.org/login?qr_login=1`). The browser remembers it; `?qr_login=0` turns it off again. `NEXT_PUBLIC_QR_LOGIN=1` turns it on for a whole build.
- **Desktop**: start the app with `OPENAGENTS_QR_LOGIN=1`, or set `localStorage.oa_qr_login = "1"` in the launcher window's devtools.

Until the app can scan, a phone camera works too: the code is a workspace URL (`/qr-login?id=…`), and that page asks a phone browser that is signed in to the workspace to approve.

## Flow

```
computer                          backend                         phone (signed in)
POST /v1/auth/qr          ──────▶ request, 2 min
  ◀── id, poll_secret, qr_url
draw qr_url as a QR code
                                                     ◀──── POST /v1/auth/qr/{id}/scan     (Bearer)
POST /{id}/poll ──▶ "scanned"                              ──── device, client
                                                     ◀──── POST /v1/auth/qr/{id}/approve  (Bearer)
POST /{id}/poll ──▶ "approved" + session (once)
```

- The code only carries the request id. Collecting the session needs `poll_secret`, which never leaves the computer that asked, so a photo of the code cannot sign anyone in.
- The session is the same 30-day workspace session `POST /v1/auth/session` issues, for the account that approved. Renew it with `POST /v1/auth/session/renew`.
- Requests live in the shared Redis (`REDIS_URL`) under `qr_login:<id>`. Without `REDIS_URL` (local development) they live in process memory, which only works with one worker. When `REDIS_URL` is set but Redis is down, QR login answers 503.

## API for the mobile app

All responses use the usual envelope `{code, message, data}`. The phone's calls take its normal bearer (workspace session, Firebase or Apple token).

**Reading the code.** The QR code is a URL like `https://workspace.openagents.org/qr-login?id=<id>`. Take `id` from the query string. It matches `^[A-Za-z0-9_-]{16,64}$`. Treat any other URL as not a login code (open it normally or ignore it).

### `POST /v1/auth/qr/{id}/scan`

Call right after reading the code. It claims the request for this account and tells the computer to show "Scanned". Use the answer for the confirmation screen.

`200` data:

| field | example | meaning |
|---|---|---|
| `status` | `"scanned"` | |
| `client` | `"web"` or `"desktop"` | what is asking to sign in |
| `device` | `"Chrome on macOS"`, `"OpenAgents desktop app on Windows"` | from the computer's user agent |
| `created_at`, `expires_at` | ISO 8601 | the phone has until `expires_at` (2 minutes after the scan) to answer |

Errors: `401` not signed in, `409` already scanned by another account / already used, `410` expired or unknown (ask the user to refresh the code on the computer).

The confirmation screen should name the device and the account, and warn that approving gives that device full access. That warning is the defence against someone sending a user their own code to scan.

### `POST /v1/auth/qr/{id}/approve`

Signs the computer in to this account. A separate `scan` call is not required, but the confirmation screen should come first. `200` with `status: "approved"`. Same errors as `scan`; only the account that scanned may approve.

### `POST /v1/auth/qr/{id}/cancel`

The user said no. The computer shows "cancelled" and offers a new code. `200` with `status: "cancelled"`.

## API for the computer

### `POST /v1/auth/qr`

Body `{"client": "web" | "desktop"}` (optional, default `web`). `200` data: `id`, `poll_secret`, `qr_url`, `expires_at`, `poll_interval_ms` (1500). `503` when workspace sessions or the store are unavailable.

### `POST /v1/auth/qr/{id}/poll`

Body `{"poll_secret": "…"}`. `200` data `status`: `pending`, `scanned`, `approved`, `cancelled` or `expired`. The first poll that sees `approved` also gets `session` `{session_token, expires_at, email, display_name}`, and the request is deleted. `403` for a wrong secret.

Clients: web `components/auth/qr-login.tsx` and `lib/qr-login.ts`; desktop `packages/launcher/src/renderer/pages/workspace/qr-sign-in.tsx` and `AccountManager.startQrSignIn` / `pollQrSignIn`, which keep the poll secret in the main process. Backend `app/routers/qr_login.py` and `app/qr_login.py`.
