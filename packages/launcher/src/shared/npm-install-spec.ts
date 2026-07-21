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
