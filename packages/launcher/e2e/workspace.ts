// Workspace API helpers for the "respond" assertion — ported from
// tests/e2e/agent-smoke.js. We drive install/create/configure/connect/start
// through the GUI, then send a message + poll for the agent's reply over the
// same public workspace API (`/v1/events`) the platform smoke uses. This keeps
// the reply check independent of any launcher UI (logs/chat) rendering.

const BASE = process.env.WORKSPACE_API_BASE_URL || "https://workspace-endpoint.openagents.org"
const TOKEN = process.env.E2E_WS_TOKEN || ""
const SLUG = process.env.E2E_WS_SLUG || ""

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "X-Workspace-Token": TOKEN,
    "Content-Type": "application/json",
  }
}

export function haveWorkspaceCreds(): boolean {
  return !!TOKEN && !!SLUG
}

/** The workspace under test, as the launcher will list and bind it. */
export const WS_SLUG = SLUG

// A dedicated test account that is a member of the E2E workspace. Pairing a
// device needs a signed-in person (see createPairingCode); the Firebase web key
// is public — it ships in the Workspace frontend (workspace/frontend/lib/firebase.ts).
const USER_EMAIL = process.env.E2E_USER_EMAIL || ""
const USER_PASSWORD = process.env.E2E_USER_PASSWORD || ""
const FIREBASE_API_KEY =
  process.env.E2E_FIREBASE_API_KEY || "AIzaSyCXgN-7HfgAQiN0pRKqGi8jMbGGo9e9X34"

export function haveMemberCreds(): boolean {
  return !!USER_EMAIL && !!USER_PASSWORD
}

/** Sign the test member in with email/password and return a Firebase ID token. */
async function signInMember(): Promise<string> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD, returnSecureToken: true }),
    },
  )
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.idToken)
    throw new Error(`E2E member sign-in failed (${res.status}): ${body?.error?.message || "no idToken"}`)
  return body.idToken as string
}

/**
 * Mint a single-use node pairing code for this workspace.
 *
 * Joining is device-level now: the launcher redeems an XXXX-XXXX code to
 * register this machine as a node, and only then can an agent be bound to the
 * workspace. Codes are short-lived and single-use, so a run cannot carry one in
 * a secret — it mints its own. Since v1.1 `POST /v1/workspaces/{slug}/pairing-codes`
 * requires a signed-in workspace member, who owns the connection; a workspace
 * token is no longer enough, so the test member signs in first — and joins the
 * workspace if it is not a member yet (see joinWorkspace).
 */
export async function createPairingCode(): Promise<string> {
  const idToken = await signInMember()
  const mint = () =>
    fetch(`${BASE}/v1/workspaces/${encodeURIComponent(SLUG)}/pairing-codes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    })
  let res = await mint()
  if (res.status === 403) {
    await joinWorkspace(idToken)
    res = await mint()
  }
  if (!res.ok)
    throw new Error(
      `POST /v1/workspaces/${SLUG}/pairing-codes ${res.status}: ${await res.text()}`,
    )
  const body = await res.json()
  const code = body?.data?.code
  if (!code) throw new Error(`pairing-codes returned no code: ${JSON.stringify(body)}`)
  return code as string
}

/**
 * Make the test member a member of the workspace under test, so whichever
 * workspace E2E_WS_SLUG names needs no manual setup. The workspace token is
 * the workspace's own trusted machine credential and may create invites; an
 * open (not email-bound, so nothing is mailed) member invite is accepted as the
 * test member and revoked straight away, leaving no usable link behind.
 */
async function joinWorkspace(idToken: string): Promise<void> {
  const invites = `${BASE}/v1/workspaces/${encodeURIComponent(SLUG)}/invites`
  const created = await fetch(invites, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ role: "member", note: "launcher E2E test member" }),
  })
  if (!created.ok)
    throw new Error(`POST /v1/workspaces/${SLUG}/invites ${created.status}: ${await created.text()}`)
  const invite = (await created.json())?.data
  const inviteToken = String(invite?.url || "").split("/invite/")[1]
  try {
    const accepted = await fetch(`${BASE}/v1/invites/${encodeURIComponent(inviteToken)}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    })
    if (!accepted.ok)
      throw new Error(`accepting the E2E member invite failed ${accepted.status}: ${await accepted.text()}`)
  } finally {
    await fetch(`${invites}/${encodeURIComponent(invite.inviteId)}`, {
      method: "DELETE",
      headers: headers(),
    }).catch(() => {})
  }
}

/**
 * Unpair a device this run paired. Every cell pairs a fresh device, so without
 * this each nightly run would leave up to 13 registered devices — each with a
 * live token — in the E2E workspace. The member who minted the code owns the
 * connection and may remove it.
 */
export async function removeDevice(nodeId: string): Promise<void> {
  const idToken = await signInMember()
  const res = await fetch(`${BASE}/v1/nodes/${encodeURIComponent(nodeId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${idToken}` },
  })
  if (!res.ok && res.status !== 404)
    throw new Error(`DELETE /v1/nodes/${nodeId} ${res.status}: ${await res.text()}`)
}

async function fetchEvents(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${BASE}/v1/events?${qs}`, { headers: headers() })
  if (!res.ok) throw new Error(`GET /v1/events ${res.status}`)
  return res.json()
}

/** Post a chat message mentioning the agent into its channel. */
export async function sendMessage(
  agentName: string,
  sessionName: string,
  content: string,
): Promise<void> {
  const body = {
    type: "workspace.message.posted",
    source: "human:e2e",
    target: `channel/${sessionName}`,
    payload: {
      content,
      sender_type: "human",
      mentions: [agentName],
      message_type: "chat",
    },
    metadata: { target_agents: [agentName] },
    visibility: "channel",
    network: SLUG,
  }
  const res = await fetch(`${BASE}/v1/events`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST /v1/events ${res.status}: ${await res.text()}`)
}

/** Newest event id, used as a baseline cursor before sending. */
export async function baselineCursor(): Promise<string | null> {
  const r = await fetchEvents({ network: SLUG, sort: "asc", limit: "50" })
  return (r.data && r.data.newest_id) || null
}

function textOf(ev: any): string {
  const p = ev.payload || {}
  return p.content || p.text || p.message || p.response || p.output || ""
}

function isAgentReply(ev: any, agentName: string, sessionName: string): boolean {
  if (ev.type !== "workspace.message.posted") return false
  if (ev.source === "human:e2e") return false
  if (ev.target !== `channel/${sessionName}`) return false
  const p = ev.payload || {}
  const msgType = p.message_type || "chat"
  if (msgType === "thinking" || msgType === "status") return false
  const isAgent =
    p.sender_type === "agent" ||
    (ev.source && ev.source.includes(agentName)) ||
    (ev.source && ev.source.startsWith("openagents:"))
  if (!isAgent) return false
  const text = textOf(ev)
  if (!text.trim() || text.trim().toLowerCase() === "thinking...") return false
  return true
}

/** Poll until the agent posts a chat reply in its channel, or timeout. */
export async function pollForReply(
  agentName: string,
  sessionName: string,
  cursor: string | null,
  timeoutMs = 240_000,
  intervalMs = 5_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let after = cursor
  while (Date.now() < deadline) {
    const r = await fetchEvents(
      after
        ? { network: SLUG, sort: "asc", limit: "50", after }
        : { network: SLUG, sort: "asc", limit: "50" },
    )
    const events = (r.data && r.data.events) || []
    if (r.data && r.data.newest_id) after = r.data.newest_id
    for (const ev of events) {
      if (isAgentReply(ev, agentName, sessionName)) return textOf(ev)
    }
    await new Promise((res) => setTimeout(res, intervalMs))
  }
  throw new Error(`No agent reply within ${timeoutMs / 1000}s`)
}
