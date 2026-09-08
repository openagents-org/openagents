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

/**
 * Mint a single-use node pairing code for this workspace.
 *
 * Joining is device-level now: the launcher redeems an XXXX-XXXX code to
 * register this machine as a node, and only then can an agent be bound to the
 * workspace. Codes are short-lived and single-use, so a run cannot carry one in
 * a secret — it mints its own. `POST /v1/workspaces/{slug}/pairing-codes` is
 * owner/admin gated, and a workspace or node token counts as a trusted machine
 * credential there, so the token the reply assertion already needs is enough.
 */
export async function createPairingCode(): Promise<string> {
  const res = await fetch(
    `${BASE}/v1/workspaces/${encodeURIComponent(SLUG)}/pairing-codes`,
    { method: "POST", headers: headers() },
  )
  if (!res.ok)
    throw new Error(
      `POST /v1/workspaces/${SLUG}/pairing-codes ${res.status}: ${await res.text()}`,
    )
  const body = await res.json()
  const code = body?.data?.code
  if (!code) throw new Error(`pairing-codes returned no code: ${JSON.stringify(body)}`)
  return code as string
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
