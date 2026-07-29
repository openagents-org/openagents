/**
 * Writes MCP server entries into the agents' own config files.
 *
 * Handing an agent a raw API key isn't enough for most platforms — unlike
 * gemini, which reads GEMINI_API_KEY natively, an agent like claude or cursor
 * has no idea what to do with a LINEAR_API_KEY. What it does understand is an
 * MCP server. So on top of the .env injection we register the platform's
 * hosted MCP endpoint, authenticated with the credential we already hold.
 *
 * Every client here speaks Streamable HTTP but spells the entry differently,
 * which is what `McpTarget.entry` normalises.
 *
 * NOTE: the secret lands in these config files in cleartext. That is how every
 * MCP client consumes static bearer auth today; callers must surface it.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

export interface McpServerSpec {
  /** Key under `mcpServers`. */
  name: string
  /** Streamable-HTTP endpoint. */
  url: string
  headers?: Record<string, string>
}

export interface McpTarget {
  /** Agent type, matching the registry ids the rest of the launcher uses. */
  id: string
  label: string
  /** Absolute path to the client's user-level config file. */
  file: string
  /** Shape of one entry under `mcpServers` for this client. */
  entry: (spec: McpServerSpec) => Record<string, unknown>
}

export interface McpTargetState {
  id: string
  label: string
  file: string
  /** The client's config file or its directory exists — i.e. it's installed. */
  detected: boolean
  /** This platform's server is already registered in that file. */
  configured: boolean
  /** Set when the file exists but couldn't be parsed — writing is refused. */
  error?: string
}

/**
 * Hosted MCP endpoints, keyed by the Connections platform id. Only platforms
 * listed here get the "Configure MCP" affordance.
 */
export const MCP_CATALOG: Record<
  string,
  { name: string; url: string; authHeader: (secret: string) => Record<string, string> }
> = {
  linear: {
    name: 'linear',
    // Linear's hosted server accepts a personal API key as a bearer token,
    // which lets us skip the interactive OAuth dance entirely.
    url: 'https://mcp.linear.app/mcp',
    authHeader: (secret) => ({ Authorization: `Bearer ${secret}` }),
  },
}

function home(...parts: string[]): string {
  return path.join(os.homedir(), ...parts)
}

/**
 * Clients whose user-level config is JSON. Codex is deliberately absent: its
 * config is TOML and remote servers additionally need
 * `experimental_use_rmcp_client` on older builds, so a naive merge would risk
 * corrupting a hand-edited file.
 */
export const MCP_TARGETS: McpTarget[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    file: home('.claude.json'),
    entry: (s) => ({ type: 'http', url: s.url, ...(s.headers ? { headers: s.headers } : {}) }),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    file: home('.cursor', 'mcp.json'),
    entry: (s) => ({ url: s.url, ...(s.headers ? { headers: s.headers } : {}) }),
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    file: home('.gemini', 'settings.json'),
    // `url` means SSE to the Gemini CLI; streamable HTTP is `httpUrl`.
    entry: (s) => ({ httpUrl: s.url, ...(s.headers ? { headers: s.headers } : {}) }),
  },
]

type Json = Record<string, unknown>

function readJson(file: string): { data: Json; existed: boolean; error?: string } {
  if (!fs.existsSync(file)) return { data: {}, existed: false }
  try {
    const raw = fs.readFileSync(file, 'utf-8').trim()
    if (!raw) return { data: {}, existed: true }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { data: {}, existed: true, error: 'Config root is not a JSON object' }
    }
    return { data: parsed as Json, existed: true }
  } catch (err) {
    return { data: {}, existed: true, error: (err as Error).message }
  }
}

/**
 * Write via temp file + rename so a crash mid-write can't truncate the config,
 * and keep a one-time backup the first time we ever touch a file — ~/.claude.json
 * in particular holds a lot of unrelated state.
 */
function writeJson(file: string, data: Json): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const backup = `${file}.openagents.bak`
  if (fs.existsSync(file) && !fs.existsSync(backup)) {
    try {
      fs.copyFileSync(file, backup)
    } catch {
      // A missing backup shouldn't block the write; the temp+rename below
      // still protects against a partial file.
    }
  }
  const tmp = `${file}.openagents.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
  fs.renameSync(tmp, file)
}

function serversOf(data: Json): Json {
  const s = data.mcpServers
  return s && typeof s === 'object' && !Array.isArray(s) ? (s as Json) : {}
}

function targetDetected(target: McpTarget): boolean {
  return fs.existsSync(target.file) || fs.existsSync(path.dirname(target.file))
}

/**
 * Per-agent state for one platform: installed? already registered?
 *
 * `targets` is injectable so tests can point at a scratch directory instead of
 * the real ~/.claude.json.
 */
export function listMcpTargets(
  platform: string,
  targets: McpTarget[] = MCP_TARGETS,
): McpTargetState[] {
  const spec = MCP_CATALOG[platform]
  return targets.map((target) => {
    const { data, error } = readJson(target.file)
    return {
      id: target.id,
      label: target.label,
      file: target.file,
      detected: targetDetected(target),
      configured: !!spec && Object.prototype.hasOwnProperty.call(serversOf(data), spec.name),
      error,
    }
  })
}

export interface McpApplyResult {
  ok: boolean
  written: string[]
  errors: string[]
}

/**
 * Register (or refresh) the platform's MCP server in each requested agent's
 * config. `secret` is the cleartext credential; callers must never log it.
 */
export function applyMcpServer(
  platform: string,
  secret: string,
  targetIds: string[],
  targets: McpTarget[] = MCP_TARGETS,
): McpApplyResult {
  const spec = MCP_CATALOG[platform]
  if (!spec) return { ok: false, written: [], errors: [`No MCP server known for ${platform}`] }

  const written: string[] = []
  const errors: string[] = []
  for (const id of targetIds) {
    const target = targets.find((t) => t.id === id)
    if (!target) {
      errors.push(`${id}: unknown MCP target`)
      continue
    }
    const { data, error } = readJson(target.file)
    if (error) {
      // Refuse rather than clobber a file we failed to understand.
      errors.push(`${target.label}: ${error}`)
      continue
    }
    try {
      data.mcpServers = {
        ...serversOf(data),
        [spec.name]: target.entry({
          name: spec.name,
          url: spec.url,
          headers: spec.authHeader(secret),
        }),
      }
      writeJson(target.file, data)
      written.push(id)
    } catch (err) {
      errors.push(`${target.label}: ${(err as Error).message}`)
    }
  }
  return { ok: errors.length === 0, written, errors }
}

/** Drop the platform's MCP server from each requested agent's config. */
export function removeMcpServer(
  platform: string,
  targetIds: string[],
  targets: McpTarget[] = MCP_TARGETS,
): McpApplyResult {
  const spec = MCP_CATALOG[platform]
  if (!spec) return { ok: false, written: [], errors: [`No MCP server known for ${platform}`] }

  const written: string[] = []
  const errors: string[] = []
  for (const id of targetIds) {
    const target = targets.find((t) => t.id === id)
    if (!target) {
      errors.push(`${id}: unknown MCP target`)
      continue
    }
    const { data, existed, error } = readJson(target.file)
    if (!existed) continue
    if (error) {
      errors.push(`${target.label}: ${error}`)
      continue
    }
    const servers = serversOf(data)
    if (!Object.prototype.hasOwnProperty.call(servers, spec.name)) continue
    try {
      delete servers[spec.name]
      data.mcpServers = servers
      writeJson(target.file, data)
      written.push(id)
    } catch (err) {
      errors.push(`${target.label}: ${(err as Error).message}`)
    }
  }
  return { ok: errors.length === 0, written, errors }
}
