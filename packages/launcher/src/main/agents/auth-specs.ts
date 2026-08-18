/**
 * How each agent authenticates, as data.
 *
 * The launcher has to know three things the shared registry does not carry:
 * which agents it collects an API key for itself, which sign in through their
 * own CLI, and which do both. Everything downstream — onboarding's auth mode,
 * the Configure dialog's fields, the readiness verdict in the Agents list —
 * is derived from the tables below, so adding an agent is a data edit rather
 * than a new branch in five places.
 */

/**
 * Launcher-side auth overrides for agents that authenticate with an API key /
 * base URL. These agents ship in the shared registry with an interactive
 * terminal login (`claude login`, `gemini`, `codex login`), but the launcher
 * prefers to collect the key/base-URL directly in onboarding and inject it into
 * the agent's env — no external terminal. We apply this purely in launcher code
 * so agent-specific Launcher behavior does not have to depend on the installed
 * core version. Pi mirrors the same fields in the shared registry as well,
 * because its adapter also consumes them directly.
 *
 * When an entry exists for an agent we: use these fields as the onboarding
 * inputs, force "env" auth mode, and drop the login command so the terminal
 * path never appears.
 */
const LAUNCHER_AUTH_OVERRIDES: Record<
  string,
  Array<Record<string, unknown>>
> = {
  claude: [
    {
      name: "ANTHROPIC_API_KEY",
      description: "Anthropic API key",
      required: true,
      password: true,
    },
    {
      name: "ANTHROPIC_BASE_URL",
      description:
        "Anthropic-compatible base URL (the default works for direct Anthropic API; change it for a proxy or relay)",
      required: true,
      default: "https://api.anthropic.com",
      placeholder: "https://api.anthropic.com",
    },
    // No `default`: a pinned model id ages out (and a pre-filled one gets saved
    // whether or not the user meant it), which is exactly how agents ended up
    // calling models their account no longer serves. Empty means "the CLI's own
    // default"; the launcher's model picker fills this from the live list —
    // Anthropic's /v1/models for a key or relay. See main/agents/model-catalog.
    {
      name: "ANTHROPIC_MODEL",
      description:
        "Model name — leave empty to use Claude Code's default, or pick one from the list (a relay's channels rarely match the official ids)",
      required: true,
      placeholder: "claude-opus-5",
    },
    // A long-lived subscription token, produced by `claude setup-token` on a
    // machine that IS signed in. It is the third auth path, and the only one
    // that transfers: a Pro/Max user can sign in once and paste the token onto
    // every other machine (no API credit, no browser flow, no support call
    // walking someone through a terminal). Claude Code reads it directly, and
    // it outranks the API key — so it stays OPTIONAL and empty by default.
    {
      name: "CLAUDE_CODE_OAUTH_TOKEN",
      description:
        "Long-lived subscription token from `claude setup-token` — paste one generated on a machine you already signed in on (works with Pro/Max, needs no API credit)",
      required: false,
      password: true,
      placeholder: "sk-ant-oat01-…",
    },
  ],
  // Gemini authenticates EITHER via its CLI's Google sign-in (the default
  // `gemini` OAuth login, detected by the core's check_ready) OR via an API key.
  // The key is therefore an OPTIONAL alternative — none of these fields are
  // `required`, so a user who signs in with Google is never forced to enter a
  // key. See KEY_OPTIONAL_LOGIN_AGENTS, which keeps the registry login_command
  // flowing into onboarding/Configure so both paths are offered.
  gemini: [
    {
      name: "GEMINI_API_KEY",
      description:
        "Google AI Studio API key — get one at https://aistudio.google.com/apikey (optional if you sign in with Google)",
      required: false,
      password: true,
    },
    {
      name: "GOOGLE_GEMINI_BASE_URL",
      description:
        "Gemini-compatible base URL (the default works for Google AI Studio; change it for a proxy or custom gateway)",
      required: false,
      default: "https://generativelanguage.googleapis.com",
      placeholder: "https://generativelanguage.googleapis.com",
    },
    {
      name: "GEMINI_MODEL",
      description:
        "Model name — leave empty to use the Gemini CLI's default, or pick one from the list (loaded from your key's own /models response)",
      required: false,
      placeholder: "gemini-2.5-pro",
    },
  ],
  codex: [
    {
      name: "OPENAI_API_KEY",
      description: "OpenAI API key",
      required: true,
      password: true,
    },
    {
      name: "OPENAI_BASE_URL",
      description:
        "OpenAI-compatible base URL (the default works for the OpenAI API; change it for a proxy or relay)",
      required: true,
      default: "https://api.openai.com/v1",
      placeholder: "https://api.openai.com/v1",
    },
    // `gpt-5-codex` used to be the default here. OpenAI has since retired it,
    // so every ChatGPT-login codex agent that inherited it — or fell through to
    // the CLI's own build-time default — failed on the first message. The list
    // now comes from codex's own `models_cache.json`, which is written for the
    // signed-in account; empty means whatever the CLI picks.
    {
      name: "CODEX_MODEL",
      description:
        "Model name — leave empty to use the Codex CLI's default, or pick one from the list (which is loaded from your signed-in account or your relay)",
      required: true,
    },
  ],
  pi: [
    {
      name: "PI_PROVIDER",
      description:
        "Provider: anthropic/openai for native APIs or compatible relays, deepseek for the native DeepSeek API, openai-codex for an existing Pi subscription login, or custom.",
      required: false,
      default: "anthropic",
      options: [
        "anthropic",
        "openai",
        "deepseek",
        "openai-codex",
        "openrouter",
        "google",
        "custom",
      ],
    },
    {
      name: "PI_MODEL",
      description:
        "Exact model id exposed by the provider or relay — pick one from the list, which is loaded from the provider you selected above.",
      required: false,
      placeholder: "claude-opus-5",
    },
    {
      name: "PI_API_FORMAT",
      description:
        "API protocol. Keep auto for native providers; choose the relay's protocol when a Base URL is set.",
      required: false,
      default: "auto",
      options: [
        "auto",
        "anthropic-messages",
        "openai-completions",
        "openai-responses",
      ],
    },
    {
      name: "PI_BASE_URL",
      description:
        "Optional relay/proxy base URL. Leave blank for the provider's native API.",
      required: false,
      placeholder: "https://relay.example.com/v1",
    },
    {
      name: "PI_API_KEY",
      description:
        "API key for the selected provider or relay. Leave blank to reuse an existing Pi /login session.",
      required: false,
      password: true,
    },
    {
      name: "PI_THINKING",
      description:
        "Reasoning effort: off, minimal, low, medium, high, xhigh, max.",
      required: false,
      default: "off",
      options: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    },
    {
      name: "PI_TRUST_PROJECT",
      description:
        "Set to 1 to load project-local executable Pi settings, extensions and skills.",
      required: false,
      default: "0",
      options: ["0", "1"],
    },
  ],
  kimi: [
    {
      name: "KIMI_API_KEY",
      description: "Moonshot / Kimi API key (also accepts MOONSHOT_API_KEY)",
      required: true,
      password: true,
    },
    {
      name: "KIMI_BASE_URL",
      description: "Kimi API base URL (OpenAI-compatible endpoint)",
      required: true,
      default: "https://api.moonshot.ai/v1",
      placeholder: "https://api.moonshot.ai/v1",
    },
    {
      name: "KIMI_MODEL",
      description: "Kimi model name",
      required: true,
      default: "kimi-k2.6",
      placeholder: "kimi-k2.6",
    },
  ],
  openclaw: [
    {
      name: "LLM_API_KEY",
      description: "API key",
      required: true,
      password: true,
    },
    {
      name: "LLM_BASE_URL",
      description: "API base URL (OpenAI-compatible endpoint)",
      required: true,
      default: "https://api.openai.com/v1",
      placeholder: "https://api.openai.com/v1",
    },
    {
      name: "LLM_MODEL",
      description:
        "Model name — pick one from the list, which is loaded from the base URL above",
      required: true,
    },
  ],
  opencode: [
    {
      name: "LLM_API_KEY",
      description: "API key",
      required: true,
      password: true,
    },
    {
      name: "LLM_BASE_URL",
      description: "API base URL (OpenAI-compatible endpoint)",
      required: true,
      default: "https://api.openai.com/v1",
      placeholder: "https://api.openai.com/v1",
    },
    {
      name: "LLM_MODEL",
      description:
        "Model name — pick one from the list, which is loaded from the base URL above",
      required: true,
    },
  ],
  // Cline supports many providers (its own account, Anthropic, OpenAI,
  // OpenRouter, …). The launcher collects an optional per-run API key plus the
  // provider/model selection (mapped by the adapter to Cline's -k/-P/-m). All
  // fields are optional: a user can instead run `cline auth` to sign in and the
  // agent will use Cline's stored credentials.
  cline: [
    {
      name: "CLINE_API_KEY",
      description:
        "API key for the selected provider — or leave blank and run `cline auth` to sign in.",
      required: false,
      password: true,
    },
    {
      name: "CLINE_PROVIDER",
      description:
        "Provider id (cline, anthropic, openai, openrouter, …). Leave blank for Cline's configured default.",
      required: false,
      placeholder: "openrouter",
    },
    {
      name: "CLINE_MODEL",
      description: "Model id for the selected provider.",
      required: false,
      placeholder: "anthropic/claude-sonnet-4.6",
    },
  ],
}

/**
 * Agents that authenticate through their OWN hosted login flow (a browser /
 * device sign-in built into the CLI), not an API key the launcher collects or
 * can probe. Cursor is the canonical example — `cursor-agent` signs in via
 * Cursor's service, so there is no key endpoint to "Test connection" against and
 * no env for the user to fill in. The launcher cannot capture the token (the CLI
 * stores it locally, e.g. under ~/.cursor); it can only drive the CLI's own
 * `login` command and read its `status`. For these agents the launcher:
 *   • shows no API-key config (getEnvFields → []), so the post-install wizard
 *     and the Configure dialog skip the "Save & test connection" step that can
 *     only ever fail;
 *   • surfaces the CLI's `loginCommand` so Configure shows a "Login" button
 *     (opens a terminal running the sign-in) instead of key fields; and
 *   • derives readiness from the CLI's own `status` output (signed in?) rather
 *     than an API key. The shared registry's check_ready for these carries only
 *     a binary hint and no credential/login rule, so the core otherwise reports
 *     ready:false ("CLI not found") even when the CLI IS installed — which is
 *     exactly why the Agents list showed "Not installed" while the marketplace
 *     showed "Installed".
 *
 * `apiKeyEnv` lets a power user skip the browser login by setting that env var
 * (Cursor accepts CURSOR_API_KEY); when present the agent is ready without a
 * `status` probe. `statusArgs` is run against the resolved binary; sign-in is
 * derived from its output (see `loginVerdict`) via either or both of:
 *   • `loggedOutPattern` — match ⇒ signed OUT (for terse CLIs like Cursor whose
 *     status is just "Not logged in" vs an account line);
 *   • `loggedInPattern`  — match ⇒ signed IN (for verbose CLIs like Hermes whose
 *     status always lists "not logged in" for every unconfigured provider, so a
 *     negative match is useless — we look for a positive "✓ logged in" instead).
 * One is enough for a CLI that exits 0 either way: "ran clean and matched
 * nothing" then stands in for the pattern's opposite. Declare BOTH when the CLI
 * exits non-zero while signed out (codex does), because that shortcut is gated
 * on a clean exit and would otherwise leave the verdict permanently unknown.
 * The probe runs ASYNC (status can take seconds, e.g. Hermes ~2.5s) and the
 * result is cached; sync health reads the cache and never blocks the main loop.
 */
export interface HostedLoginSpec {
  loginCommand: string
  statusArgs: string[]
  loggedOutPattern?: RegExp
  loggedInPattern?: RegExp
  apiKeyEnv?: string
  // Some CLIs (Gemini) have no non-interactive `status` command — auth is an
  // interactive TUI flow that just writes a credentials file. When set, sign-in
  // is detected by this file's existence (relative to the home dir) INSTEAD of
  // spawning `statusArgs` (which for those CLIs would launch the TUI and hang).
  credsFile?: string
  // Env vars wiped when the user signs in via the browser flow. Hosted-login
  // agents have no env UI (getEnvFields → []), so any saved value is stale
  // leftover that overrides the login session — e.g. an invalid CURSOR_API_KEY
  // or CURSOR_MODEL from the old setup wizard, which is what broke the workspace
  // chat ("API key is invalid"). Clearing them lets the CLI use its own login +
  // account defaults.
  loginClearsEnv?: string[]
}

/**
 * Env vars that count as "this agent has credentials". `*_API_KEY` covers the
 * usual case; `CLAUDE_CODE_OAUTH_TOKEN` is Claude's pasteable subscription
 * token, which authenticates on its own and would otherwise leave an agent that
 * is perfectly configured reading "Not configured".
 *
 * Deliberately narrow — matching every `*_TOKEN` would count things like a
 * GitHub token, which authenticates nothing about the model.
 */
export const CREDENTIAL_ENV = /API_KEY$|^CLAUDE_CODE_OAUTH_TOKEN$/

/**
 * Readiness reason codes surfaced to the Agents list. These MUST match the
 * core's health-status REASON values (packages/agent-connector/src/adapters/
 * health-status.js) so the Install page, the Agents list and the daemon share
 * one vocabulary. The renderer keys off `reason` (not the free-text message) to
 * decide whether to show "Not installed" vs "Login required".
 *
 * Hard rule: NOT_INSTALLED is only for a genuinely missing executable; an
 * installed-but-signed-out agent is LOGIN_REQUIRED.
 */
export const READY_REASON = {
  READY: "ready",
  NOT_INSTALLED: "not_installed",
  LOGIN_REQUIRED: "login_required",
} as const

export const HOSTED_LOGIN_AGENTS: Record<string, HostedLoginSpec> = {
  cursor: {
    loginCommand: "cursor-agent login",
    statusArgs: ["status"],
    loggedOutPattern: /not logged in|logged out|signed out/i,
    apiKeyEnv: "CURSOR_API_KEY",
    // Only the KEY. CURSOR_MODEL used to be wiped alongside it, from back when
    // the setup wizard could save a model Cursor no longer served and the CLI
    // preferred that dead value over its account default. The model now comes
    // from `cursor-agent --list-models` (the account's own list), so a chosen
    // model is a deliberate setting — clearing it on every sign-in check meant
    // the picker could never stick.
    loginClearsEnv: ["CURSOR_API_KEY"],
  },
  hermes: {
    // `hermes setup` is the interactive wizard; `hermes status` prints a rich
    // report where a configured auth provider reads "✓ logged in" (everything
    // unconfigured reads "✗ not logged in"), so match the positive marker.
    loginCommand: "hermes setup",
    statusArgs: ["status"],
    loggedInPattern: /✓\s*logged in/i,
  },
}

/**
 * Amp's "signed out" marker. Amp has no dedicated status/whoami command, so the
 * sign-in probe and the API-key test both run `amp usage` (credit balance) and
 * look for this error, which Amp prints verbatim when unauthenticated:
 *   "Error: Invalid or missing API key. Run 'amp login' to authenticate."
 */
export const AMP_LOGGED_OUT = /invalid or missing api key|run ['"]?amp login/i

/**
 * Agents that support BOTH paths: an API key the launcher collects (see
 * LAUNCHER_AUTH_OVERRIDES) AND their CLI's own browser sign-in. Claude Code is
 * the canonical example — `claude auth login` signs in via claude.ai (a Pro/Max
 * subscription works without any API key), and `claude auth status` reports the
 * result as JSON (`"loggedIn": true`). The launcher-redesign dropped this login
 * path and left only the API-key fields; this restores the legacy "open Claude
 * to log in" option as the PRIMARY one while keeping the key as an alternative.
 *
 * Unlike HOSTED_LOGIN_AGENTS these KEEP their env (API-key) fields — they reuse
 * the same `status`-probe machinery (`_probeHostedLogin`) for sign-in detection
 * but are NOT treated as login-only anywhere that would hide the key fields
 * (getEnvFields, getOnboardingAgents.envFields) or force a login-only health
 * verdict. Onboarding sets authMode "login" (key offered as a secondary path),
 * and readiness is "installed AND (signed in OR has a key)".
 */
export const DUAL_LOGIN_AGENTS: Record<string, HostedLoginSpec> = {
  claude: {
    // `claude auth login` opens the browser sign-in; `claude auth status`
    // prints `{ "loggedIn": true, ... }` (exit 0) when authenticated.
    loginCommand: "claude auth login",
    statusArgs: ["auth", "status"],
    loggedInPattern: /"loggedIn"\s*:\s*true/i,
  },
  codex: {
    // Codex authenticates the same way: `codex login` signs in with a ChatGPT
    // account (a Plus/Pro/Team plan works with NO OpenAI API key — the auth is
    // stored in ~/.codex/auth.json), and `codex login status` reports it.
    // Treating codex as key-only forced an OPENAI_API_KEY on users who actually
    // sign in via ChatGPT, and the adapter then injected that key into the CLI
    // env — flipping the CLI out of its working ChatGPT session into API-key
    // mode, which fails for accounts without API/Responses access. Dual-login
    // makes the ChatGPT sign-in the primary path with the key as a fallback.
    //
    // `codex login status` prints "Logged in using ChatGPT" / "Logged in using
    // an API key" when authenticated and "Not logged in" otherwise; the
    // positive pattern matches only the former (it does not match "Not logged
    // in", which contains no "using").
    //
    // The signed-out wording is spelled out as well because codex exits **1**
    // when signed out (verified on Windows, codex 0.147.0: `EXIT 1 | OUT: "Not
    // logged in"`). Without it, loginVerdict's clean-exit shortcut can't fire
    // and a signed-out codex reads as null/unknown — which health.ts treats
    // optimistically, leaving the agent looking usable right up until every
    // message to it fails.
    loginCommand: "codex login",
    statusArgs: ["login", "status"],
    loggedInPattern: /logged in using/i,
    loggedOutPattern: /not logged in/i,
  },
  amp: {
    // Amp (Sourcegraph) authenticates against Sourcegraph's own service, two
    // ways: `amp login` opens the browser sign-in (token stored in
    // ~/.config/amp/settings.json), or the user sets AMP_API_KEY directly (an
    // access token from ampcode.com/settings — see the registry env_config).
    // Amp ships no status/whoami command, so the sign-in probe runs `amp usage`
    // (it prints the credit balance when authenticated and AMP_LOGGED_OUT's
    // error otherwise); a negative match on that error means signed in. A saved
    // AMP_API_KEY is honored separately by _reconcileAgentHealth (it counts as
    // configured credentials), so readiness is "installed AND (signed in OR has
    // a key)" just like the other dual-login agents.
    loginCommand: "amp login",
    statusArgs: ["usage"],
    loggedOutPattern: AMP_LOGGED_OUT,
  },
  gemini: {
    // Gemini CLI (v0.46) has NO `login`/`auth`/`status` subcommand — auth is the
    // interactive "Login with Google" OAuth flow reached by launching the CLI
    // (its `/auth` picker), or a GEMINI_API_KEY. So the login command is bare
    // `gemini` (on first run it prompts for the auth method and opens the browser
    // sign-in), and sign-in is detected by the OAuth token cache it writes at
    // ~/.gemini/oauth_creds.json — there is no status command to spawn, and
    // spawning bare `gemini` for a probe would launch its TUI and hang. A saved
    // GEMINI_API_KEY counts as configured credentials separately, so readiness is
    // "installed AND (signed in OR has a key)" like the other dual-login agents.
    loginCommand: "gemini",
    statusArgs: [],
    credsFile: ".gemini/oauth_creds.json",
  },
}

/**
 * The launcher-auth fields for an agent type, with `required` cleared for
 * dual-login agents. Claude/Codex (and Amp) accept an API key OR a CLI sign-in,
 * so their key/base-URL/model inputs are an ALTERNATIVE to login and must be
 * OPTIONAL — otherwise a user who signed in via `claude auth login` / `codex
 * login` can't save the (deliberately empty) config: the Configure dialog,
 * onboarding, and the post-install wizard all reject the save on a missing
 * required field. Env-only override agents (Kimi, …) keep their fields as
 * declared. Returns null when the agent has no launcher override.
 */
export function launcherAuthFields(
  type: string,
): Array<Record<string, unknown>> | null {
  const override = LAUNCHER_AUTH_OVERRIDES[type]
  if (!override) return null
  if (DUAL_LOGIN_AGENTS[type]) {
    return override.map((f) => ({ ...f, required: false }))
  }
  return override
}

/**
 * Agents in LAUNCHER_AUTH_OVERRIDES that ALSO authenticate via their CLI's own
 * sign-in, so the API key is an OPTIONAL alternative — never required. Unlike
 * DUAL_LOGIN_AGENTS these have NO CLI `status` probe: their sign-in is detected
 * by the core's check_ready (e.g. Gemini's ~/.gemini/oauth_creds.json), so
 * readiness and refreshLogin fall through to healthCheck. For these agents the
 * launcher keeps the (optional) key fields AND surfaces the registry's
 * `login_command`, so onboarding + the Configure dialog offer BOTH paths.
 *
 * Add an agent here only when its registry check_ready declares a login_command
 * and a credential probe (creds_file / creds_path_env / env_vars). This is the
 * sanctioned, data-driven way to express "key OR CLI login" without a renderer
 * `agentType === 'gemini'` special-case.
 */
export const KEY_OPTIONAL_LOGIN_AGENTS = new Set<string>(["gemini"])

/**
 * The agents the launcher/workspace core officially supports today, in the
 * order product wants them surfaced. Anything NOT in this set is shown as
 * "coming soon" in the Install marketplace — visible but not installable,
 * sorted to the bottom — and omitted from onboarding, so users stay on the
 * supported set. The onboarding picker (Step 1) offers exactly this set,
 * intersected with the runnable ADAPTER_MAP, so the first-run choices line up
 * one-for-one with the marketplace's installable agents. Kept in launcher code
 * (not the shared registry) so
 * the supported list can move independently of the catalog, and `coreOrder`
 * gives a single display order regardless of the registry's own
 * featured/order (which is inconsistent for e.g. gemini).
 */
export const CORE_AGENTS: readonly string[] = [
  "claude",
  "openclaw",
  "codex",
  "cursor",
  "opencode",
  "hermes",
  "kimi",
  "gemini",
  // Amp (Sourcegraph): external curl install + `amp login`/AMP_API_KEY auth.
  // aider/goose/copilot/cline are intentionally NOT in this set — they stay
  // "coming soon" (visible but not installable) so the supported download list
  // is the core agents + amp.
  "amp",
  // Pi (Earendil): npm install on all three platforms, no native build step,
  // and a smaller download than Claude Code. Its provider integration is
  // validated, so it is a supported download rather than "coming soon".
  //
  // Listing a type here only stamps it installable in the Install marketplace.
  // Onboarding and addAgent additionally intersect with
  // getSupportedAgentTypes(), which reads the INSTALLED core's adapter map —
  // so a core without a pi adapter can't create a pi agent whatever this list
  // says. That ordering matters: ship the core adapter first, or the
  // marketplace offers an install that cannot be turned into a running agent.
  "pi",
  // DeepSeek Harness (dsh): npm install on all three platforms, exact-pinned
  // to the upstream developer-preview version. Enabled once core 0.2.169 (the
  // first core containing the deepseek adapter) was published — same
  // core-before-marketplace ordering as pi above. addAgent still intersects
  // with the installed core's adapter map, so a stale core degrades to
  // "unsupported" rather than a broken install.
  "deepseek",
  // NanoClaw is intentionally NOT in this set: it's a BETA external
  // containerized runtime bridged via a native NanoClaw `openagents` channel,
  // so it stays "coming soon" (visible but not installable) and out of
  // onboarding rather than being surfaced as a supported download. It remains
  // in the runnable ADAPTER_MAP for existing workspaces. See docs/agents/nanoclaw.md.
]

export const CORE_AGENT_ORDER = new Map<string, number>(
  CORE_AGENTS.map((name, i) => [name, i]),
)
