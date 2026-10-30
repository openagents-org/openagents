/**
 * Every on-disk location the launcher shares with the agent core.
 *
 * These were scattered as module-level consts at the top of agent-manager.ts,
 * which meant any module that needed one had to import the whole 5k-line file.
 * They live here so the daemon, chat and install modules can each reach the
 * same paths without that dependency.
 */
import path from "path"
import fs from "fs"
import os from "os"

export const CONFIG_DIR = path.join(os.homedir(), ".openagents")

/** Core installed by the runtime bootstrap into the portable node prefix. */
export const GLOBAL_CORE = path.join(
  CONFIG_DIR,
  "nodejs",
  "node_modules",
  "@openagents-org",
  "agent-launcher",
)

/** The monorepo's own copy, used in dev. Resolved from the bundled main file. */
export const LOCAL_CORE = path.resolve(__dirname, "../../../agent-connector")

export const INSTALLED_HISTORY_FILE = path.join(
  CONFIG_DIR,
  "installed_agents_history.json",
)

export const DAEMON_PID_FILE = path.join(CONFIG_DIR, "daemon.pid")
export const DAEMON_STATUS_FILE = path.join(CONFIG_DIR, "daemon.status.json")
export const DAEMON_CMD_FILE = path.join(CONFIG_DIR, "daemon.cmd")
export const DAEMON_LOG_FILE = path.join(CONFIG_DIR, "daemon.log")

/** Where chat session metadata is kept, one JSON file per channel. */
export const LAUNCHER_SESSIONS_DIR = path.join(CONFIG_DIR, "launcher-sessions")

/** The portable Node runtime the launcher downloads on first run. */
export const PORTABLE_NODE_DIR = path.join(CONFIG_DIR, "nodejs")

/** mkdir -p, best-effort: callers all treat a missing dir as "nothing saved". */
export function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
}
