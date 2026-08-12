/**
 * What the Agents list means by "Ready".
 *
 * The core's own check_ready answers a narrower question than the UI asks, and
 * gets two things wrong from the launcher's point of view:
 *   1. it resolves binaries with `which`, which misses the isolated runtimes the
 *      launcher installs into (~/.openagents/runtimes/<type>/…), so a working
 *      agent reads "Not installed"; and
 *   2. it only looks at TYPE-level env, so an agent configured per-instance
 *      reads "Not configured".
 * Everything here is that reconciliation, plus the login-aware verdicts for
 * agents that sign in through their own CLI.
 */
import {
  CREDENTIAL_ENV,
  DUAL_LOGIN_AGENTS,
  HOSTED_LOGIN_AGENTS,
  READY_REASON,
} from "./auth-specs"

export interface HealthResolverDeps {
  /** Install check matching the marketplace's "Installed" badge. */
  isInstalled: (type: string) => boolean
  /** Version found on disk, or null when nothing is installed. */
  getInstalledVersion: (type: string) => string | null
  /** Saved TYPE-level env for an agent. */
  getTypeEnv: (type: string) => Record<string, string> | undefined
  /** Cached CLI sign-in state: true / false / null-unknown. */
  loginIsAuthed: (type: string) => boolean | null
  /** Registry entry, for its not_ready_message hint. */
  getRegistryEntry: (type: string) => Record<string, unknown> | null
}

export class HealthResolver {
  constructor(private deps: HealthResolverDeps) {}

  /** True when an env map carries any non-empty API key (e.g. *_API_KEY). */
  envHasApiKey(env: Record<string, string> | undefined): boolean {
    if (!env || typeof env !== "object") return false
    return Object.entries(env).some(
      ([k, v]) => CREDENTIAL_ENV.test(k) && !!(v || "").trim(),
    )
  }

  /** True when saved TYPE-level env for this agent carries any non-empty key. */
  hasConfiguredCredentials(type: string): boolean {
    try {
      return this.envHasApiKey(this.deps.getTypeEnv(type))
    } catch {
      return false
    }
  }

  /** Registry's not-ready hint for an agent type, with a sensible fallback. */
  notReadyMessage(type: string): string {
    try {
      const entry = this.deps.getRegistryEntry(type)
      const checkReady = entry?.check_ready as
        { not_ready_message?: string } | undefined
      if (checkReady?.not_ready_message) return checkReady.not_ready_message
    } catch {}
    return "Not configured — add an API key in Configure"
  }

  /**
   * Message for an agent that IS installed but not yet usable (signed out / no
   * API key). Reuses the registry's not_ready hint when it reads as a login
   * prompt, but NEVER surfaces a stale "not installed" wording for a resolved
   * binary — that would re-introduce the exact bug this fix removes.
   */
  loginRequiredMessage(type: string): string {
    const msg = this.notReadyMessage(type)
    if (msg && !/not\s+installed/i.test(msg)) return msg
    return "Installed · Login required — sign in or add an API key"
  }

  /**
   * Message for a genuinely-missing executable. Reuses the registry hint only
   * when it actually says "not installed"; otherwise a plain "Not installed".
   * (amp's not_ready_message now describes a login state, so it must NOT be used
   * for the not-installed case.)
   */
  notInstalledMessage(type: string): string {
    const msg = this.notReadyMessage(type)
    if (msg && /not\s+installed/i.test(msg)) return msg
    return "Not installed"
  }

  /**
   * Health for hosted-login agents (e.g. Cursor). Install is confirmed with the
   * connector's isInstalled — the same check the marketplace's "Installed" badge
   * uses, so the two views never disagree. Readiness then follows the CLI's own
   * sign-in state (its `status` command): signed in ⇒ Ready; signed out ⇒ a
   * clear "click Login" hint rather than a misleading "Ready"; unknown (probe
   * failed/timed out) ⇒ optimistic Ready so a working agent is never blocked.
   */
  hostedLoginHealth(type: string): Record<string, unknown> {
    if (!this.deps.isInstalled(type)) {
      return {
        installed: false,
        ready: false,
        reason: READY_REASON.NOT_INSTALLED,
        auth_mode: null,
        execution_mode: "unavailable",
        message: this.notInstalledMessage(type),
      }
    }
    const signedIn = this.deps.loginIsAuthed(type)
    // A saved key is a valid alternative to the browser sign-in here — Cursor
    // accepts CURSOR_API_KEY, and reconcileAgentHealth has always honored it
    // for the per-agent verdict. This per-TYPE verdict didn't, which nobody
    // could hit while the field was hidden; now that it's reachable, "signed
    // out" alone must not read as unusable or a user who just pasted a key
    // watches the badge stay red.
    const hasKey = this.hasConfiguredCredentials(type)
    if (signedIn === false && !hasKey) {
      return {
        installed: true,
        ready: false,
        reason: READY_REASON.LOGIN_REQUIRED,
        auth_mode: null,
        logged_in: false,
        execution_mode: "unavailable",
        message: "Not signed in — open Configure and click Login",
      }
    }
    return {
      installed: true,
      ready: true,
      reason: READY_REASON.READY,
      // Key first, matching reconcileAgentHealth: it's what the CLI actually
      // runs with, and it overrides any sign-in session.
      auth_mode: hasKey ? "api_key" : "cli_login",
      // Distinct from `ready` on purpose: the sign-in card must show whether
      // the user is SIGNED IN, not whether the agent happens to be usable via
      // a key. Null when the probe hasn't answered yet.
      logged_in: signedIn,
      execution_mode: "subprocess",
      message: "Ready",
    }
  }

  /**
   * Combine a dual-auth agent's core (API-key) health with its CLI sign-in
   * state. `logged_in` is the cached probe value (true / false / null-unknown);
   * the read is non-blocking and kicks a background `status` probe when stale.
   * Ready = installed AND (signed in OR an API key is configured).
   */
  dualLoginHealth(type: string, core: unknown): Record<string, unknown> {
    const h = (core && typeof core === "object" ? core : {}) as Record<
      string,
      unknown
    >
    const loggedIn = this.deps.loginIsAuthed(type)
    const installed = this.deps.isInstalled(type) || h.installed === true
    const hasKey =
      h.ready === true ||
      h.auth_mode === "api_key" ||
      this.hasConfiguredCredentials(type)
    const ready = installed && (loggedIn === true || hasKey)
    return {
      ...h,
      installed,
      ready,
      logged_in: loggedIn,
      reason: ready
        ? READY_REASON.READY
        : !installed
          ? READY_REASON.NOT_INSTALLED
          : READY_REASON.LOGIN_REQUIRED,
      auth_mode:
        loggedIn === true
          ? "cli_login"
          : hasKey
            ? "api_key"
            : (h.auth_mode ?? null),
      // Installed-but-signed-out is Login-required, not "not installed". Uses the
      // agent's own registry hint (e.g. amp → "run: amp login or set
      // AMP_API_KEY") instead of a Claude-specific string.
      message: ready
        ? "Ready"
        : !installed
          ? this.notInstalledMessage(type)
          : this.loginRequiredMessage(type),
    }
  }

  /**
   * Correct a false "Not installed" from the core health check.
   *
   * The core resolves an agent's binary with `which`/`where` against PATH, but
   * agents the launcher installs live in isolated runtimes
   * (~/.openagents/runtimes/<type>/node_modules/.bin) that are NOT on the user's
   * PATH. So a freshly-installed agent can report `installed:false` ("Not
   * installed") from the health check even though the marketplace — which uses a
   * filesystem package.json check (getInstallInfo) — correctly shows it
   * installed. That mismatch surfaced in the Agents list as a confusing
   * "⚠ Not installed" badge on a working agent. Trust the filesystem: if the npm
   * package is present on disk, mark it installed and re-derive readiness from
   * saved credentials so the label reflects configuration, not binary lookup.
   */
  reconcileHealth(type: string, health: unknown): unknown {
    if (!health || typeof health !== "object") return health
    const h = health as Record<string, unknown>
    if (h.installed !== false) return health
    // Only override when the launcher can independently confirm the install via
    // the filesystem. api_only agents (no npm package) are already handled
    // correctly by the core via its marker check, so getInstalledVersion being
    // null there means "leave the core's verdict alone".
    if (!this.deps.getInstalledVersion(type)) return health
    const ready = this.hasConfiguredCredentials(type)
    return {
      ...h,
      installed: true,
      ready,
      reason: ready ? READY_REASON.READY : READY_REASON.LOGIN_REQUIRED,
      auth_mode: ready ? "api_key" : null,
      execution_mode: ready ? h.execution_mode || "direct" : "unavailable",
      // Binary confirmed on disk → never "not installed"; show login-required.
      message: ready ? "Ready" : this.loginRequiredMessage(type),
    }
  }

  /**
   * Per-agent health, fixing two false negatives in the core's per-TYPE check:
   *  1. "Not installed" — the core resolves binaries with `which`, which misses
   *     isolated-runtime installs (handled by reconcileHealth via filesystem).
   *  2. "Not configured" — the core evaluates readiness against TYPE-level saved
   *     env (~/.openagents/env/<type>.env) ONLY. But Configure on an existing
   *     agent saves INSTANCE env into daemon.yaml (saveAgentInstanceEnv), so a
   *     fully-configured agent (valid key/base/model, Test connection passes)
   *     still shows "Not configured". Trust the instance's own env here.
   */
  reconcileAgentHealth(
    type: string,
    instanceEnv: Record<string, string> | undefined,
    typeHealth: unknown,
  ): unknown {
    // Hosted-login agents (e.g. Cursor, Hermes) sign in through their own CLI,
    // not an API key the launcher collects. Readiness = installed + signed in
    // (or, where the CLI accepts one, an API key set in env). A power user who
    // set CURSOR_API_KEY skips the browser login, so honor that before login.
    const hostedLogin = HOSTED_LOGIN_AGENTS[type]
    if (hostedLogin) {
      const hasApiKey =
        !!(
          hostedLogin.apiKeyEnv &&
          (instanceEnv?.[hostedLogin.apiKeyEnv] || "").trim()
        ) || this.hasConfiguredCredentials(type)
      if (this.deps.isInstalled(type) && hasApiKey) {
        return {
          installed: true,
          ready: true,
          reason: READY_REASON.READY,
          auth_mode: "api_key",
          execution_mode: "direct",
          message: "Ready",
        }
      }
      // Prefer the cached login-aware health from the 30s refresh. Until it
      // populates, return an optimistic install-only verdict rather than probing
      // `status` here — getAgents runs every ~1.5s and must not spawn the CLI.
      if (typeHealth && typeof typeHealth === "object") return typeHealth
      return this.deps.isInstalled(type)
        ? {
            installed: true,
            ready: true,
            reason: READY_REASON.READY,
            auth_mode: "cli_login",
            execution_mode: "subprocess",
            message: "Ready",
          }
        : {
            installed: false,
            ready: false,
            reason: READY_REASON.NOT_INSTALLED,
            auth_mode: null,
            execution_mode: "unavailable",
            message: this.notInstalledMessage(type),
          }
    }
    const health = this.reconcileHealth(type, typeHealth)
    // Dual-auth agents (Claude) are ready with EITHER a key OR a CLI sign-in, so
    // a subscription login with no API key isn't misreported as "Not configured".
    // The sign-in read is the cached probe (non-blocking; kicks a refresh when
    // stale) — same constraint as hosted agents, so getAgents never spawns here.
    const cliLoggedIn = DUAL_LOGIN_AGENTS[type]
      ? this.deps.loginIsAuthed(type) === true
      : false
    // A configured API key — instance-level, or the type's saved env — is what
    // the adapter actually injects and runs with, and it overrides any CLI
    // sign-in session (see the DUAL_LOGIN_AGENTS/codex note). So the auth_mode
    // LABEL must follow the key FIRST: an instance the user gave a key to reads
    // "API key", not "CLI login", even when `claude auth status` also reports a
    // signed-in session. Only fall back to "cli_login" when no key is set.
    const hasKey =
      this.envHasApiKey(instanceEnv) || this.hasConfiguredCredentials(type)
    const hasCreds = cliLoggedIn || hasKey
    // The type-level health is populated asynchronously (see
    // _scheduleHealthRefresh), so right after onboarding it is still null. Don't
    // fall back to a misleading "Not configured" when the agent actually has a
    // saved API key — synthesize a ready status from the configured credentials.
    if (!health || typeof health !== "object") {
      if (hasCreds) {
        return {
          installed: true,
          ready: true,
          reason: READY_REASON.READY,
          auth_mode: hasKey ? "api_key" : "cli_login",
          execution_mode: "direct",
          message: "Ready",
        }
      }
      return health
    }
    const h = health as Record<string, unknown>
    if (h.installed === false) return health
    // A ready agent needs no further reconciliation of its STATE — but the core
    // reports readiness, not always how the agent authenticates, and an empty
    // auth_mode surfaces in the agents list as "—" next to an agent the user
    // did configure a key for. Fill it in from what the launcher itself saved;
    // a value the core already supplied always wins.
    if (h.ready === true) {
      if (h.auth_mode) return health
      return {
        ...h,
        auth_mode: hasKey ? "api_key" : cliLoggedIn ? "cli_login" : null,
      }
    }
    if (hasCreds) {
      return {
        ...h,
        installed: true,
        ready: true,
        reason: READY_REASON.READY,
        auth_mode: hasKey ? "api_key" : "cli_login",
        execution_mode:
          h.execution_mode && h.execution_mode !== "unavailable"
            ? h.execution_mode
            : "direct",
        message: "Ready",
      }
    }
    // Installed (binary resolved) but no usable credentials/login detected:
    // surface a Login-required state, never a "not installed" message. The core
    // health already carries reason='login_required' for this case; harden it
    // here so a probe that hasn't populated yet can't fall through to the raw
    // (possibly stale) message.
    if (h.installed === true && h.ready !== true) {
      return {
        ...h,
        reason: READY_REASON.LOGIN_REQUIRED,
        message: this.loginRequiredMessage(type),
      }
    }
    return health
  }
}
