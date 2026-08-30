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

/**
 * `getAgentChangelog`'s error when the agent has no npm package to query.
 * Shared so the renderer can recognise it and say something useful instead of
 * showing an internal string; every other error there is a real fetch failure.
 */
export const NO_NPM_PACKAGE = "NO_NPM_PACKAGE"

/**
 * `@scope/name` or `name`, optionally followed by `@<spec>`.
 *
 * `i` is accepted alongside `install` because npm accepts it, so a registry
 * entry may reasonably be written either way. Missing the alias would classify
 * a genuine npm agent as script-installed and silently drop its version
 * reporting — the same failure this file exists to prevent, from the other
 * direction.
 */
const NPM_INSTALL_RE =
  /npm\s+(?:install|i)\s+(?:-g\s+)?(@?[\w-]+(?:\/[\w-]+)?)(?:@(\S+))?$/

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
 * The npm package a registry entry installs, or null when it does not install
 * one at all.
 *
 * Null is the important half. Roughly half the catalog ships through a vendor
 * script (`curl -fsSL https://ampcode.com/install.sh | bash`) or nothing at all
 * (an `echo`-only placeholder entry), and those agents have no npm identity
 * to look up. The caller must treat null as "no version information available"
 * rather than substituting something that looks like a package name.
 *
 * `install.binary` in particular is NOT a fallback. It is the executable's name
 * — `amp`, `goose`, `hermes` — and every one of those is also an
 * unrelated package on the public npm registry. Reading versions from them
 * reported the wrong "latest" for seven agents, left a permanent
 * "update available" badge that reinstalling could never clear, and pointed the
 * update path at `npm install -g amp@latest`, which installs a message-protocol
 * library over an AI coding agent.
 *
 * @param platformKey the registry's key for this OS: macos / linux / windows
 */
export function resolveNpmPackage(
  install: Record<string, unknown> | undefined | null,
  platformKey: string,
): string | null {
  if (!install) return null
  if (typeof install.npm_package === "string" && install.npm_package)
    return install.npm_package
  const cmd = (install[platformKey] || install.command || install.npm) as
    | string
    | undefined
  return parseNpmInstallCommand(cmd).pkg
}

/**
 * The command an *update* runs, derived from the registry's install command.
 *
 * Always `@latest` for npm agents, whatever the registry says:
 *
 *   - `npm install <pkg>` with a satisfied range already in package.json is a
 *     no-op ("up to date"), so a bare command never moves the version.
 *   - A pinned command (`pi-coding-agent@0.83.0`) reinstalls the version the
 *     user already has. That pin is a fresh-install baseline, and the registry
 *     is hand-maintained, so it goes stale the moment upstream publishes —
 *     the launcher would offer "Update to v0.84.1" and install 0.83.0 forever.
 *
 * The version the button advertises comes from npm's `latest` dist-tag
 * (AgentManager._loadAgentUpdates), so pinning `@latest` here is what makes the
 * promise and the command agree. Non-npm installers (curl / pip / echo) are
 * returned untouched: their scripts already fetch the newest build.
 */
export function updateInstallCommand(
  cmd: string | undefined,
): string | undefined {
  if (!cmd || !NPM_INSTALL_RE.test(cmd)) return cmd
  return `${stripInstallVersion(cmd)}@latest`
}

/**
 * The install command without any `@<version>` suffix.
 *
 * What the detail rail shows: the pin in a hand-maintained registry says which
 * build was last vetted, not which one the user gets, and printing a version
 * that the update path deliberately ignores only invites "why does it say
 * 0.83.0?". Non-npm installers are returned untouched.
 */
export function stripInstallVersion(
  cmd: string | undefined,
): string | undefined {
  if (!cmd) return cmd
  const m = cmd.match(NPM_INSTALL_RE)
  if (!m || !m[2]) return cmd
  // The match runs to the end of the string, so cutting `@<spec>` off the tail
  // cannot touch a scoped package's leading `@`.
  return cmd.slice(0, cmd.length - (m[2].length + 1))
}

/**
 * The exact version a command pins, or null when it floats.
 *
 * A dist-tag (`@latest`, `@beta`) is not a pin — it resolves to whatever is
 * newest on that channel. Only a literal version freezes the install, and that
 * is the thing the launcher overrides.
 */
export function pinnedVersion(cmd: string | undefined): string | null {
  const { pkg, spec } = parseNpmInstallCommand(cmd)
  if (!pkg || !spec) return null
  return /^\d/.test(spec) ? spec : null
}

/**
 * The command to *show* the user for a given action.
 *
 * The confirm dialog exists to let people see what is about to touch their
 * machine, so it must print what the launcher will actually run: `@latest` for
 * every update, and for an install whose registry command carries a frozen
 * version (which the launcher overrides — see
 * AgentManager.installAgentTypeStreaming). Everything else is shown verbatim.
 * Derived from the same parse as the execution path so the two cannot drift.
 *
 * `supportedVersion` is the exception in both directions. An entry declaring
 * `install.supported_version` is pinned deliberately — its adapter runs against
 * that release and no other — so neither install nor update overrides it, and
 * showing `@latest` here would promise a command the launcher does not run AND
 * name a version that would not work if it did.
 */
export function displayInstallCommand(
  cmd: string | undefined,
  verb: "install" | "update",
  supportedVersion?: string | null,
): string | undefined {
  if (!cmd) return cmd
  if (supportedVersion) {
    const { pkg } = parseNpmInstallCommand(cmd)
    return pkg ? cmd.replace(/(@?[\w-]+(?:\/[\w-]+)?)(@\S+)?$/, `$1@${supportedVersion}`) : cmd
  }
  return verb === "update" || pinnedVersion(cmd)
    ? updateInstallCommand(cmd)
    : cmd
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
