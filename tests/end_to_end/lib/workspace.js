"use strict"

/**
 * The workspace side of the run: mint the pairing code the launcher redeems.
 *
 * Workspaces are created on the web and reach a device by pairing — the
 * launcher has no "create workspace" path any more — so an automated run has to
 * start where a person would: ask the workspace for a code, then hand it to the
 * app. `POST /v1/workspaces/{id}/pairing-codes` is the same call the web UI
 * makes behind "Connect a device".
 */

const API_ENVELOPE_HINT =
  "expected {code, message, data} from the workspace API — check the base URL"

/**
 * One HTTP call to the workspace, retried through a flaky connection.
 *
 * Only transport failures are retried, never an HTTP status: a 404 or a 403 is
 * an answer and means the same thing the second time. A dropped TLS handshake
 * is not — and a daily job that reports every agent red because one connection
 * blipped is a job people stop reading.
 */
async function apiCall(base, route, opts) {
  const attempts = 3
  for (let attempt = 1; ; attempt++) {
    try {
      return await apiCallOnce(base, route, opts)
    } catch (err) {
      if (!err.transient || attempt >= attempts) throw err
      await new Promise((r) => setTimeout(r, attempt * 2_000))
    }
  }
}

async function apiCallOnce(
  base,
  route,
  { method = "GET", token, body, timeoutMs = 30_000 },
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(`${base.replace(/\/$/, "")}${route}`, {
      method,
      signal: controller.signal,
      headers: {
        "X-Workspace-Token": token,
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (err) {
    const failure = new Error(
      err.name === "AbortError"
        ? `${method} ${route} timed out after ${Math.round(timeoutMs / 1000)}s`
        : `${method} ${route} failed: ${err.message}`,
    )
    failure.transient = true
    throw failure
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    throw new Error(
      `${method} ${route} → ${res.status}: not JSON (${API_ENVELOPE_HINT})`,
    )
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${route} → ${res.status}: ${(parsed && parsed.message) || text.slice(0, 200)}`,
    )
  }
  return parsed && parsed.data !== undefined ? parsed.data : parsed
}

/**
 * A fresh single-use pairing code (XXXX-XXXX, 30-minute TTL).
 *
 * Needs an owner/admin credential for the workspace: the workspace token works,
 * which is what the daily runner is configured with.
 */
async function mintPairingCode({ apiBase, token, id }) {
  const route = `/v1/workspaces/${encodeURIComponent(id)}/pairing-codes`
  const data = await apiCall(apiBase, route, {
    method: "POST",
    token,
    body: {},
  })
  const code = data && data.code
  if (!code) {
    throw new Error(`workspace returned no pairing code (${API_ENVELOPE_HINT})`)
  }
  return { code, expiresAt: data.expiresAt || null }
}

/**
 * Drop the agent's membership row from the workspace.
 *
 * Removing the agent on the launcher side does NOT do this: the core's
 * `disconnectWorkspace` only clears the local binding, so the workspace keeps
 * showing the agent as a (permanently offline) member. Left alone, a daily run
 * files a fresh corpse in the members list every day.
 *
 * Best effort by design — a 404 means someone already cleaned it up, and no
 * cleanup failure should turn a passing agent red.
 */
async function removeMember({ apiBase, token, id }, agentName) {
  const route = `/v1/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(agentName)}`
  try {
    await apiCall(apiBase, route, { method: "DELETE", token })
    return true
  } catch {
    return false
  }
}

/** Fail early and clearly when the endpoint or token is wrong. */
async function checkWorkspace({ apiBase, token, id }) {
  const route = `/v1/workspaces/${encodeURIComponent(id)}`
  const data = await apiCall(apiBase, route, { token })
  return {
    id: (data && (data.id || data.workspaceId)) || id,
    slug: (data && data.slug) || id,
    name: (data && data.name) || id,
  }
}

module.exports = { mintPairingCode, checkWorkspace, removeMember, apiCall }
