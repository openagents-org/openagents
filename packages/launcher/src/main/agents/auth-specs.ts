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

import {
  CODEBUDDY_SESSION_FILES,
  codebuddySessionMatchesRegion,
} from "./codebuddy-signin"

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
  // Antigravity (agy) authenticates like gemini: Google sign-in OR an API
  // key, so nothing here is required. agy reads ONLY GEMINI_API_KEY (not
  // GOOGLE_API_KEY), and needs modelProvider:"gemini" in its settings file —
  // the core adapter writes that entry whenever the key is configured.
  antigravity: [
    {
      name: "GEMINI_API_KEY",
      description:
        "Google AI Studio API key — get one at https://aistudio.google.com/apikey (optional if you sign in with Google via `agy`)",
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
      name: "ANTIGRAVITY_MODEL",
      description:
        "Model slug — leave empty to use agy's default, or pick one from the list (loaded from your key's own /models response)",
      required: false,
      placeholder: "gemini-3-pro",
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
  // Credentials first, then the endpoint, then the model: the model list is
  // loaded FROM the key + base URL, so a picker sitting above them can only
  // ever say "fill in the API key above" while pointing at nothing. Every
  // other agent here is already in this order.
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
      name: "PI_API_KEY",
      description:
        "API key for the selected provider or relay. Leave blank to reuse an existing Pi /login session.",
      required: false,
      password: true,
    },
    {
      name: "PI_BASE_URL",
      description:
        "Optional relay/proxy base URL. Leave blank for the provider's native API.",
      required: false,
      placeholder: "https://relay.example.com/v1",
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
      name: "PI_MODEL",
      description:
        "Exact model id exposed by the provider or relay — pick one from the list, which is loaded from the provider you selected above.",
      required: false,
      placeholder: "claude-opus-5",
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
      description:
        "Moonshot / Kimi API key (also accepts MOONSHOT_API_KEY). Leave blank to use `kimi login`.",
      required: false,
      password: true,
    },
    {
      name: "KIMI_BASE_URL",
      description: "Kimi API base URL (OpenAI-compatible endpoint)",
      required: false,
      default: "https://api.moonshot.ai/v1",
      placeholder: "https://api.moonshot.ai/v1",
    },
    {
      name: "KIMI_MODEL",
      description: "Kimi model name",
      required: false,
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
  // interactive TUI flow that just leaves evidence on disk. When set, sign-in is
  // read from these files INSTEAD of spawning `statusArgs` (which for those CLIs
  // would launch the TUI and hang). Paths are relative to the home dir and are
  // tried in order; the first hit wins. `key` names a JSON field that has to
  // hold a value — without it the file only has to exist.
  credsFiles?: Array<{ path: string; key?: string }>
  /**
   * An extra condition on a creds file that was found and parsed, for a CLI
   * that keeps ONE session covering several services. CodeBuddy is the case:
   * the same file holds the international, China and iOA sign-ins, tagged with
   * the domain they came from, so "a session exists" is not yet "a session this
   * agent can use". Returning false here is a real signed-OUT verdict for this
   * agent's configuration, which is the honest answer — the alternative is
   * reporting Ready for an agent whose every task fails on auth.
   *
   * Receives the parsed creds and the agent's saved env; must read only what it
   * needs and never log it.
   */
  credsGuard?: (creds: unknown, env: Record<string, string>) => boolean
  // Env vars wiped when the user signs in via the browser flow. Hosted-login
  // agents have no env UI (getEnvFields → []), so any saved value is stale
  // leftover that overrides the login session — e.g. an invalid CURSOR_API_KEY
  // or CURSOR_MODEL from the old setup wizard, which is what broke the workspace
  // chat ("API key is invalid"). Clearing them lets the CLI use its own login +
  // account defaults.
  loginClearsEnv?: string[]
  /**
   * One line printed in the terminal above the login command, for a CLI whose
   * sign-in isn't where the user would look for it. Plain ASCII — it is echoed
   * by a shell script, not rendered by the app.
   */
  terminalHint?: string
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
export const CREDENTIAL_ENV =
  /API_KEY$|^CLAUDE_CODE_OAUTH_TOKEN$|^CODEBUDDY_AUTH_TOKEN$/

/**
 * Agents whose credential requirement depends on one of their OWN settings, so
 * "no API key saved" is not the same as "not configured".
 *
 * OpenWorker is bring-your-own-model across ~20 providers, and two of them ask
 * for no key at all: `ollama` talks to a local server, and `openai-codex`
 * reuses an existing ChatGPT sign-in out of the state directory. Judged on the
 * key alone both read "No model API key" forever — an agent that runs fine,
 * permanently badged as broken. The value maps to the auth_mode to report:
 * openai-codex really is a CLI sign-in, while ollama is neither and says so by
 * reporting none.
 *
 * Only a value listed here counts as keyless; every other provider still needs
 * its key, and an unset setting falls through to the agent's default (which for
 * OpenWorker is `openai`, a key provider).
 */
export const KEYLESS_AUTH_SETTINGS: Record<
  string,
  { setting: string; values: Record<string, string | null> }
> = {
  openworker: {
    setting: "OPENWORKER_PROVIDER",
    values: { ollama: null, "openai-codex": "cli_login" },
  },
}

/**
 * Whether this agent's saved settings select a keyless auth path, and what to
 * label it. `envs` are consulted in order and the first one that names the
 * setting decides — pass the instance env before the type env, since Configure
 * writes per-instance while onboarding writes per-type.
 */
export function keylessAuth(
  type: string,
  ...envs: Array<Record<string, string> | undefined>
): { keyless: boolean; authMode: string | null } {
  const none = { keyless: false, authMode: null }
  const rule = KEYLESS_AUTH_SETTINGS[type]
  if (!rule) return none
  for (const env of envs) {
    const value = (env?.[rule.setting] || "").trim().toLowerCase()
    if (!value) continue
    if (!Object.prototype.hasOwnProperty.call(rule.values, value)) return none
    return { keyless: true, authMode: rule.values[value] }
  }
  return none
}

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
    // Gemini CLI has NO `login`/`auth`/`status` subcommand — auth is the
    // interactive "Login with Google" OAuth flow reached by launching the CLI
    // (its `/auth` picker), or a GEMINI_API_KEY. So the login command is bare
    // `gemini`, and sign-in has to be read off disk: there is no status command
    // to spawn, and spawning bare `gemini` for a probe would launch its TUI and
    // hang. A saved GEMINI_API_KEY counts as configured credentials separately,
    // so readiness is "installed AND (signed in OR has a key)" like the other
    // dual-login agents.
    //
    // The evidence is `google_accounts.json`, which the CLI writes with the
    // signed-in address on every successful OAuth flow and nulls on sign-out.
    // It used to be `oauth_creds.json`, and that is the bug this replaces:
    // current builds keep the token in the OS keychain and never write that
    // file, so the panel said "not signed in" no matter how many times the user
    // signed in. It stays as the fallback for older CLIs, which do write it.
    loginCommand: "gemini",
    statusArgs: [],
    credsFiles: [
      { path: ".gemini/google_accounts.json", key: "active" },
      { path: ".gemini/oauth_creds.json" },
    ],
    // The terminal runs in a directory whose workspace settings ask for the
    // Google flow (see gemini-signin.ts), so the sign-in should come up on its
    // own. This line is the fallback for the case it doesn't — an older CLI
    // without workspace settings, or a folder-trust policy that overrides ours
    // — because `/auth` is the only other way in.
    terminalHint:
      "Signing in with your Google account. If Gemini opens into chat instead, type /auth and pick the Google option.",
  },
  commandcode: {
    // Command Code signs in with its own account (`command-code login`, which
    // covers its bundled plan models) and separately accepts BYOK providers,
    // so it is dual-login rather than key-only. COMMAND_CODE_API_KEY is the
    // headless/CI equivalent of that sign-in.
    //
    // The login command deliberately spells the binary `command-code` and not
    // `cmd`. The npm package installs cmd/cmdc/command-code/commandcode at one
    // entry point, and `cmd` IS the Windows command shell — a terminal handed
    // `cmd login` on Windows opens a shell prompt instead of signing anyone in.
    loginCommand: "command-code login",
    // `status` is the CLI's own "Show authentication status", and it reads the
    // answer three ways where `whoami` (what this used to spawn) reads it two:
    // "Authentication verified" / "Authenticated as <user>" on exit 0 when
    // signed in, "Not authenticated" on exit 1 when signed out, and "Status
    // check failed: …" on exit 1 when its account service is unreachable.
    // `whoami` reports that last case as "Error: Connection error." on a CLEAN
    // exit, which — matching only the signed-out wording, as this spec used to —
    // is indistinguishable from a successful whoami and reads as SIGNED IN.
    //
    // So BOTH directions are named, positive first: the signed-out copy carries
    // "authenticate" as well ("Run cmd auth login to authenticate."), and only
    // the verified / `as <user>` wording may stand for success. An unreachable
    // service then matches neither on a non-zero exit and stays UNKNOWN, which
    // health.ts treats optimistically — an offline machine never demotes a
    // signed-in user. If either pattern drifts the verdict falls back to that
    // same unknown rather than locking anyone out; the run itself still reports
    // the miss, and the adapter maps exit code 3 to an actionable sign-in error.
    statusArgs: ["status"],
    loggedInPattern: /authentication verified|authenticated as/i,
    loggedOutPattern: /not authenticated|not signed in|not logged in/i,
    apiKeyEnv: "COMMAND_CODE_API_KEY",
  },
  copilot: {
    // GitHub Copilot CLI has no login subcommand and no non-interactive status
    // command: signing in is `/login` INSIDE the session (or the CLI doing it
    // for you on first run), and the token it gets lands in the OS credential
    // store, not on disk. So the login command is the BARE binary —
    // needsRealTerminal() routes that to a terminal window — and sign-in is
    // read off disk like gemini's and codebuddy's.
    //
    // What the CLI does write is its own config, which records who is signed
    // in: `loggedInUsers: [{ host, login }]` plus a `lastLoggedInUser`. That is
    // an identity list, not a credential — the token itself is never in this
    // file, and nothing here reads a value out of it beyond "is the list
    // non-empty". Two properties of that file drove the probe changes:
    //
    //   - it is JSONC. A two-line `//` header explains that user settings
    //     belong in settings.json, so a strict JSON.parse throws and the
    //     verdict used to degrade to "cannot tell" for a plainly signed-in
    //     user. credsVerdict now falls back to a string-aware comment strip.
    //   - the field is an ARRAY, and `![]` is false — an empty list would have
    //     read as SIGNED IN. isEmptyField treats empty containers as no value.
    //
    // Deliberately no credsGuard. The entries carry a `host`, and a GHE
    // (GH_HOST / COPILOT_GH_HOST) sign-in for a different host is conceivable —
    // but that behaviour is unverified here, and a guard written on a guess
    // would report signed-OUT for working setups. The honest failure mode is
    // the milder one: a wrong-host session reads as signed in and the CLI's own
    // run result corrects it.
    loginCommand: "copilot",
    statusArgs: [],
    credsFiles: [{ path: ".copilot/config.json", key: "loggedInUsers" }],
    apiKeyEnv: "COPILOT_GITHUB_TOKEN",
    terminalHint:
      "Signing in to GitHub. If the CLI does not sign you in on its own, type /login. Close this window once it says you are signed in.",
  },
  codebuddy: {
    // CodeBuddy Code has no login subcommand at all (verified on 2.146.0: the
    // CLI exposes config/mcp/plugin/daemon/… and nothing auth-shaped). Signing
    // in is `/login` INSIDE the interactive session, so the login command is the
    // bare binary — needsRealTerminal sends it straight to a terminal window,
    // like Copilot's — and sign-in has to be read off disk.
    //
    // What it leaves behind is one session file in the CLI's extension data
    // directory. One, for every site it can talk to, tagged with the domain it
    // came from — so `credsGuard` checks that the tag agrees with the region
    // this agent is configured for. Without that check a user who signed in on
    // codebuddy.ai while their agent is pinned to the China site reads as
    // "Ready" and then fails auth on every message. See codebuddy-signin.ts.
    loginCommand: "codebuddy",
    statusArgs: [],
    credsFiles: CODEBUDDY_SESSION_FILES.map((path) => ({ path, key: "auth" })),
    credsGuard: codebuddySessionMatchesRegion,
    apiKeyEnv: "CODEBUDDY_API_KEY",
    terminalHint:
      "Type /login to sign in. This window is already pointed at the site this agent is configured for; close it once the CLI says you are signed in.",
  },
}

/**
 * The launcher-auth fields for an agent type, with `required` cleared for
 * dual-login agents. Claude/Codex (and Amp) accept an API key OR a CLI sign-in,
 * so their key/base-URL/model inputs are an ALTERNATIVE to login and must be
 * OPTIONAL — otherwise a user who signed in via `claude auth login` / `codex
 * login` can't save the (deliberately empty) config: the Configure dialog,
 * onboarding, and the post-install wizard all reject the save on a missing
 * required field. Env-only override agents (OpenClaw, …) keep their fields as
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
export const KEY_OPTIONAL_LOGIN_AGENTS = new Set<string>([
  "gemini",
  // Antigravity (agy) mirrors gemini's dual auth: Google sign-in (token in
  // the OS keyring — nothing on disk to probe, so readiness leans on the
  // core's check_ready) OR a GEMINI_API_KEY, which the core adapter pairs
  // with the required modelProvider entry automatically.
  "antigravity",
  // Kimi Code CLI: `kimi login` device-code flow (credentials under
  // ~/.kimi-code/) OR a KIMI_API_KEY the adapter maps onto the CLI's
  // KIMI_MODEL_* env-provider contract.
  "kimi",
  // GitHub Copilot CLI: a GitHub sign-in (`copilot` → /login, the browser
  // device flow) OR a COPILOT_GITHUB_TOKEN. Both of its registry env fields are
  // already declared optional, so there is nothing to relax — what this entry
  // buys is the authMode: without it the mere presence of those fields forces
  // onboarding into "env" mode and asks for a token, when the smoother and
  // far more common first-run path is the CLI sign-in.
  //
  // Like codebuddy above it is NOT in LAUNCHER_AUTH_OVERRIDES (the registry's
  // own fields are right), its login_command is the BARE binary, and it is ALSO
  // in DUAL_LOGIN_AGENTS — which is what gives that sign-in a probe: the
  // identity list the CLI records in ~/.copilot/config.json. The registry still
  // marks it `unverifiable` because the CORE has no per-platform creds path for
  // it; the launcher does.
  "copilot",
  // CodeBuddy Code: a CodeBuddy/WorkBuddy account sign-in OR a
  // CODEBUDDY_API_KEY / CODEBUDDY_AUTH_TOKEN.
  //
  // Its login_command is the BARE binary, like Copilot's — there is no
  // `codebuddy login` subcommand at all: signing in is the `/login` slash
  // command inside the interactive session, so the terminal we open drops the
  // user into the CLI where they run it. Like gemini it is ALSO in
  // DUAL_LOGIN_AGENTS, which is what gives that sign-in a probe: the session
  // file the `/login` flow writes (see codebuddy-signin.ts). The registry still
  // marks it `unverifiable` because the core has no per-platform creds path to
  // look at — the launcher does.
  "codebuddy",
])

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
  // aider/goose/cline are intentionally NOT in this set — they stay
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
  // Antigravity CLI (agy): Google's successor to Gemini CLI (which stopped
  // serving individual accounts in June 2026). External curl install +
  // `agy` Google sign-in / GEMINI_API_KEY auth. Same core-before-marketplace
  // ordering as pi/deepseek above: listing it here only stamps it installable,
  // and addAgent still intersects with the installed core's adapter map, so a
  // core older than the first one shipping the antigravity adapter degrades to
  // "unsupported" rather than a broken install.
  "antigravity",
  // Command Code (`command-code`): npm install on all three platforms, own
  // account sign-in plus BYOK providers. Same core-before-marketplace ordering
  // as pi/deepseek/antigravity above — listing it here only stamps it
  // installable, and addAgent still intersects with the installed core's
  // adapter map, so a core older than the first one shipping the commandcode
  // adapter degrades to "unsupported" rather than a broken install.
  //
  // NOTE: the CLI needs Node.js 22+. The launcher ships v22.x for its managed
  // runtimes, so an agent created here is fine; a hand-installed CLI on an
  // older Node is not, and the adapter reports that rather than guessing.
  "commandcode",
  // OpenWorker (andrewyng/openworker): the first entry here that is not a CLI
  // at all. `uv tool install git+…` puts `openworker-server` on PATH and the
  // core adapter drives it over its own WebSocket, so what the marketplace
  // installs is a local server rather than a terminal agent. Two consequences
  // worth knowing before touching this line:
  //
  //   - the install needs git AND uv on the machine. Both are checked by the
  //     core's install preflight, so a machine without them gets one named,
  //     copyable remedy instead of a shell error buried in installer output.
  //   - it is bring-your-own-model across ~20 providers, so onboarding collects
  //     a provider alongside the key; the model picker follows that choice.
  //
  // Same core-before-marketplace ordering as pi/deepseek/antigravity/commandcode
  // above: listing it here only stamps it installable, and addAgent still
  // intersects with the installed core's adapter map, so a core older than the
  // first one shipping the openworker adapter degrades to "unsupported" rather
  // than a broken install.
  "openworker",
  // CodeBuddy Code (`codebuddy`): npm install on all three platforms, and the
  // agent engine Tencent's WorkBuddy desktop app runs in its own sidecar — so
  // this is how a WorkBuddy/CodeBuddy account joins a workspace. What it is NOT
  // is WorkBuddy's office skill set: those ship inside the desktop app, not the
  // npm package, so the agent behaves as the coding/terminal one.
  //
  // Two things to know before touching this line:
  //
  //   - accounts are per-site. codebuddy.ai / workbuddy.ai and codebuddy.cn /
  //     workbuddy.cn are separate, and CODEBUDDY_REGION picks which one the CLI
  //     talks to; the wrong choice fails as a login error, not a routing one.
  //   - there is no non-interactive login command, so an account sign-in means
  //     a terminal and `/login`. The API key path exists precisely so a user
  //     never has to do that twice. See KEY_OPTIONAL_LOGIN_AGENTS.
  //
  // Same core-before-marketplace ordering as the entries above: listing it here
  // only stamps it installable, and addAgent still intersects with the installed
  // core's adapter map, so a core older than the first one shipping the
  // codebuddy adapter degrades to "unsupported" rather than a broken install.
  "codebuddy",
  // GitHub Copilot CLI (`copilot`): the official standalone terminal agent
  // shipped as `@github/copilot` — NOT the retired `gh copilot` extension. We
  // detect and launch the `copilot` executable only and never invoke `gh`.
  //
  // Three things to know before touching this line:
  //
  //   - auth is a GitHub sign-in, not a key we collect, so it is listed in
  //     KEY_OPTIONAL_LOGIN_AGENTS and DUAL_LOGIN_AGENTS: onboarding drives
  //     `copilot` /login, the optional COPILOT_GITHUB_TOKEN field stays as a
  //     backup, and a completed sign-in is read back off disk so the agent
  //     turns Ready on its own.
  //   - the login command is the BARE binary, like Copilot's peers gemini and
  //     codebuddy — signing in is `/login` INSIDE the TUI. needsRealTerminal()
  //     already routes bare-binary logins to a terminal window generically, so
  //     no name has to be added to TERMINAL_ONLY_LOGIN for that to work.
  //   - the Copilot Free plan can only use auto model selection. Leaving the
  //     model empty is what the adapter already does (it passes `--model` only
  //     when COPILOT_MODEL is set), so Free accounts work out of the box as
  //     long as nothing pre-seeds a concrete model id.
  //
  // Same core-before-marketplace ordering as the entries above: listing it here
  // only stamps it installable, and addAgent still intersects with the installed
  // core's adapter map. The copilot adapter ships in core 0.2.180 (verified in
  // the published tarball), which is what packages/launcher depends on.
  "copilot",
  // NanoClaw is intentionally NOT in this set: it's a BETA external
  // containerized runtime bridged via a native NanoClaw `openagents` channel,
  // so it stays "coming soon" (visible but not installable) and out of
  // onboarding rather than being surfaced as a supported download. It remains
  // in the runnable ADAPTER_MAP for existing workspaces. See docs/agents/nanoclaw.md.
]

export const CORE_AGENT_ORDER = new Map<string, number>(
  CORE_AGENTS.map((name, i) => [name, i]),
)
