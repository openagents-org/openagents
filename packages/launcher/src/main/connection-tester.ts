/**
 * Lightweight connection probes — no SDKs, just plain fetch() against the
 * cheapest public-API endpoint each platform exposes. Result is used to
 * surface "Connected" / "Unauthorized" / "Rate limited" / "Offline" in the UI.
 *
 * Each probe receives the resolved cleartext secret. Callers are responsible
 * for fetching the secret from CredentialsStore and never logging it.
 */

export type ProbeResult = {
  ok: boolean
  status: 'connected' | 'unauthorized' | 'rate_limited' | 'expired' | 'offline' | 'error'
  account?: string
  detail?: string
}

async function safeFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const r = await fetch(url, { ...init, signal: ctrl.signal })
    clearTimeout(t)
    return r
  } catch {
    return null
  }
}

function fromStatus(res: Response | null): ProbeResult['status'] {
  if (!res) return 'offline'
  if (res.status === 401 || res.status === 403) return 'unauthorized'
  if (res.status === 429) return 'rate_limited'
  if (res.status >= 500) return 'error'
  if (res.ok) return 'connected'
  return 'error'
}

export async function probeGitHub(token: string): Promise<ProbeResult> {
  const res = await safeFetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'OpenAgents',
    },
  })
  const status = fromStatus(res)
  if (status === 'connected' && res) {
    try {
      const j = (await res.json()) as { login?: string }
      return { ok: true, status, account: j.login }
    } catch {}
  }
  return { ok: status === 'connected', status }
}

export async function probeSlack(token: string): Promise<ProbeResult> {
  const res = await safeFetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res) return { ok: false, status: 'offline' }
  try {
    const j = (await res.json()) as { ok?: boolean; user?: string; team?: string; error?: string }
    if (j.ok) return { ok: true, status: 'connected', account: [j.team, j.user].filter(Boolean).join('/') }
    if (j.error === 'ratelimited') return { ok: false, status: 'rate_limited' }
    if (j.error === 'token_expired') return { ok: false, status: 'expired' }
    if (j.error === 'invalid_auth' || j.error === 'not_authed') return { ok: false, status: 'unauthorized' }
    return { ok: false, status: 'error', detail: j.error }
  } catch {
    return { ok: false, status: 'error' }
  }
}

export async function probeDiscord(token: string): Promise<ProbeResult> {
  const res = await safeFetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bot ${token}` },
  })
  const status = fromStatus(res)
  if (status === 'connected' && res) {
    try {
      const j = (await res.json()) as { username?: string; id?: string }
      return { ok: true, status, account: j.username || j.id }
    } catch {}
  }
  return { ok: status === 'connected', status }
}

export async function probeTelegram(token: string): Promise<ProbeResult> {
  const res = await safeFetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`)
  if (!res) return { ok: false, status: 'offline' }
  try {
    const j = (await res.json()) as { ok?: boolean; result?: { username?: string } }
    if (j.ok) return { ok: true, status: 'connected', account: j.result?.username }
    return { ok: false, status: 'unauthorized' }
  } catch {
    return { ok: false, status: 'error' }
  }
}

export async function probeNotion(token: string): Promise<ProbeResult> {
  const res = await safeFetch('https://api.notion.com/v1/users/me', {
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
  })
  const status = fromStatus(res)
  if (status === 'connected' && res) {
    try {
      const j = (await res.json()) as { name?: string; bot?: { owner?: { workspace?: boolean } } }
      return { ok: true, status, account: j.name }
    } catch {}
  }
  return { ok: status === 'connected', status }
}

export async function probeLinear(token: string): Promise<ProbeResult> {
  const res = await safeFetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ query: '{ viewer { name email } }' }),
  })
  if (!res) return { ok: false, status: 'offline' }
  if (res.status === 401 || res.status === 403) return { ok: false, status: 'unauthorized' }
  if (res.status === 429) return { ok: false, status: 'rate_limited' }
  try {
    const j = (await res.json()) as { data?: { viewer?: { name?: string; email?: string } } }
    if (j.data?.viewer) return { ok: true, status: 'connected', account: j.data.viewer.email || j.data.viewer.name }
    return { ok: false, status: 'unauthorized' }
  } catch {
    return { ok: false, status: 'error' }
  }
}

export async function probeOpenAI(token: string): Promise<ProbeResult> {
  const res = await safeFetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return { ok: !!res?.ok, status: fromStatus(res) }
}

export async function probeAnthropic(token: string): Promise<ProbeResult> {
  // The Models endpoint is the cheapest lightweight check.
  const res = await safeFetch('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': token, 'anthropic-version': '2023-06-01' },
  })
  return { ok: !!res?.ok, status: fromStatus(res) }
}

export async function probeGoogle(token: string): Promise<ProbeResult> {
  const res = await safeFetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(token)}`,
  )
  return { ok: !!res?.ok, status: fromStatus(res) }
}

export async function probe(platform: string, secret: string): Promise<ProbeResult> {
  switch (platform.toLowerCase()) {
    case 'github': return probeGitHub(secret)
    case 'slack': return probeSlack(secret)
    case 'discord': return probeDiscord(secret)
    case 'telegram': return probeTelegram(secret)
    case 'notion': return probeNotion(secret)
    case 'linear': return probeLinear(secret)
    case 'openai': return probeOpenAI(secret)
    case 'anthropic': return probeAnthropic(secret)
    case 'google': return probeGoogle(secret)
    default: return { ok: false, status: 'error', detail: `Unknown platform: ${platform}` }
  }
}
