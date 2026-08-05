/**
 * Parsing for the registry's npm install commands.
 *
 * Registry entries describe installation as a literal shell command, e.g.
 * `npm install -g @google/gemini-cli`. Both the package name and whether a
 * version was pinned have to be recovered from that string, and the two
 * answers drive different decisions:
 *
 *   - the package name locates the installed copy on disk (version reporting)
 *   - the presence of a version spec decides whether an *update* may pin
 *     `@latest` (see AgentManager.updateAgentTypeStreaming)
 *
 * Keeping both in one matcher means they can never disagree about where the
 * package name ends and the version begins.
 */

/** `@scope/name` or `name`, optionally followed by `@<spec>`. */
const NPM_INSTALL_RE = /npm install\s+(?:-g\s+)?(@?[\w-]+(?:\/[\w-]+)?)(?:@(\S+))?$/

export interface NpmInstallSpec {
  /** Package name with any version suffix removed, or null if not an npm command. */
  pkg: string | null
  /** The pinned version or dist-tag (`latest`, `1.17.11`), or null when absent. */
  spec: string | null
}

export function parseNpmInstallCommand(cmd: string | undefined): NpmInstallSpec {
  if (!cmd) return { pkg: null, spec: null }
  const m = cmd.match(NPM_INSTALL_RE)
  if (!m) return { pkg: null, spec: null }
  return { pkg: m[1], spec: m[2] ?? null }
}

/**
 * Whether an update of this agent has to pin `@latest` explicitly.
 *
 * True only for npm packages whose command carries no version of its own.
 * `npm install <pkg>` with a satisfied range already in package.json is a
 * no-op ("up to date"), so those agents would otherwise never move off the
 * version they were first installed at. Commands that already say `@latest`
 * float correctly on their own, and an explicitly pinned version
 * (`opencode-ai@1.17.11`) is a deliberate choice that must be preserved.
 */
export function needsLatestPin(cmd: string | undefined): boolean {
  const { pkg, spec } = parseNpmInstallCommand(cmd)
  return pkg !== null && spec === null
}

/**
 * The command to *show* the user for a given action.
 *
 * The confirm dialog exists to let people see what is about to touch their
 * machine, so it has to reflect the `@latest` pin that updates apply rather
 * than the registry's literal string. Installs and non-npm agents are shown
 * verbatim. Derived from the same parse as the execution path so the two
 * cannot drift apart.
 */
export function displayInstallCommand(
  cmd: string | undefined,
  verb: "install" | "update",
): string | undefined {
  if (!cmd) return cmd
  if (verb !== "update" || !needsLatestPin(cmd)) return cmd
  return `${cmd}@latest`
}

/**
 * The command that removes a *system-wide* copy — the one the launcher itself
 * will not run.
 *
 * The installer's own uninstall rewrites `-g` into `--prefix <runtimeDir>` so
 * it can only ever touch `~/.openagents/`, which is deliberate: bundled npm has
 * no business deleting packages a user installed globally themselves. That
 * leaves a copy on PATH the UI can see but not remove, so it has to be able to
 * hand the user the command instead. Returns null when the registry describes
 * the install as something other than a package-manager command (curl scripts,
 * platform installers), where there is no one-liner to offer.
 */
export function globalUninstallCommand(cmd: string | undefined): string | null {
  if (!cmd) return null
  const { pkg } = parseNpmInstallCommand(cmd)
  if (pkg) return `npm uninstall -g ${pkg}`

  const pipx = cmd.match(/pipx install\s+(\S+)/)
  if (pipx) return `pipx uninstall ${pipx[1].replace(/@\S*$/, "")}`

  const pip = cmd.match(/(pip3?) install\s+(\S+)/)
  if (pip) return `${pip[1]} uninstall -y ${pip[2].replace(/@\S*$/, "")}`

  return null
}
