import { describe, expect, it } from "vitest"

import {
  BROWSER_CLAIMED,
  CODE_PROMPT,
  findAuthUrl,
  LOGIN_FAILURE,
  LOGIN_SUCCESS,
  loginArgs,
  needsRealTerminal,
  NO_TTY,
  stripAnsi,
  TERMINAL_ONLY_LOGIN,
  YES_NO_PROMPT,
} from "./cli-login-patterns"
import { windowsExecutable } from "./cli-login"

/**
 * Verbatim output, captured by running each CLI under pipes. If a CLI changes
 * its wording these are the tests that should fail — the in-app login reads
 * nothing else.
 */
const CLAUDE_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e" +
  "&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback" +
  "&scope=org%3Acreate_api_key+user%3Aprofile&code_challenge=0_RSa6pkUkgxcAu0PZ4u7GJRIFt9NMX7fa2HnA-TG18" +
  "&code_challenge_method=S256&state=svzpX2wox3hNEMjeTxeH21_x6YAMKX-bt0N6EfRSWow"

const CLAUDE_LOGIN = `Opening browser to sign in…\nIf the browser didn't open, visit: ${CLAUDE_URL}\nPaste code here if prompted > `

const CURSOR_LOGIN =
  "Starting login process...\nAuthenticating with Cursor...\n" +
  "Waiting for browser authentication...\nIf your browser didn't open, use this link:\n" +
  "https://cursor.com/loginDeepControl?challenge=VnvuidaFF1g&uuid=ee041919-af3d&mode=login&redirectTarget=cli\n"

const AMP_LOGIN =
  "API key already configured: sgamp_user...\nDo you want to log in again? [(y)es, (n)o]: "

const HERMES_SETUP =
  "\n⚕ Hermes Setup — Non-interactive mode\n\n" +
  "  Running in a non-interactive environment (no TTY detected).\n" +
  "  The interactive wizard cannot be used here.\n"

describe("findAuthUrl", () => {
  it("pulls the whole PKCE URL out of claude's login output", () => {
    expect(findAuthUrl(CLAUDE_LOGIN)).toBe(CLAUDE_URL)
  })

  it("finds cursor's link on its own line", () => {
    expect(findAuthUrl(CURSOR_LOGIN)).toContain("cursor.com/loginDeepControl")
  })

  it("ignores non-sign-in links", () => {
    expect(findAuthUrl("See https://docs.example.com/getting-started")).toBeNull()
  })

  it("drops the sentence's trailing period", () => {
    expect(findAuthUrl("Visit https://x.dev/oauth/authorize?a=1.")).toBe(
      "https://x.dev/oauth/authorize?a=1",
    )
  })

  it("refuses a non-web scheme", () => {
    expect(findAuthUrl("file:///tmp/oauth/authorize")).toBeNull()
  })
})

describe("output markers", () => {
  it("recognises claude's code prompt", () => {
    expect(CODE_PROMPT.test(CLAUDE_LOGIN)).toBe(true)
  })

  it("does not ask cursor for a code it never wants", () => {
    expect(CODE_PROMPT.test(CURSOR_LOGIN)).toBe(false)
  })

  it("recognises amp's yes/no gate", () => {
    expect(YES_NO_PROMPT.test(AMP_LOGIN)).toBe(true)
  })

  it("recognises hermes refusing a pipe", () => {
    expect(NO_TTY.test(HERMES_SETUP)).toBe(true)
  })

  it("does not read a normal login as a TTY refusal", () => {
    expect(NO_TTY.test(CLAUDE_LOGIN)).toBe(false)
    expect(NO_TTY.test(CURSOR_LOGIN)).toBe(false)
  })

  it("reads claude's verdicts", () => {
    expect(LOGIN_SUCCESS.test("Login successful.")).toBe(true)
    expect(LOGIN_FAILURE.test("Login failed: bad state")).toBe(true)
    expect(
      LOGIN_FAILURE.test("Invalid code. Please make sure the full code was copied."),
    ).toBe(true)
    expect(LOGIN_SUCCESS.test(CLAUDE_LOGIN)).toBe(false)
  })

  it("knows when the CLI already opened a browser, so we don't open a second tab", () => {
    expect(BROWSER_CLAIMED.test(CLAUDE_LOGIN)).toBe(true)
    expect(BROWSER_CLAIMED.test(CURSOR_LOGIN)).toBe(true)
    expect(BROWSER_CLAIMED.test("https://x.dev/oauth/authorize")).toBe(false)
  })
})

describe("stripAnsi", () => {
  it("leaves a colorized prompt matchable", () => {
    const colored = `\u001B[1mPaste code here if prompted > \u001B[0m`
    expect(stripAnsi(colored)).toBe("Paste code here if prompted > ")
  })

  it("keeps square brackets that aren't escapes", () => {
    expect(stripAnsi(AMP_LOGIN)).toContain("[(y)es, (n)o]")
  })
})

describe("loginArgs", () => {
  it("drops the binary token so the absolute path can be spawned instead", () => {
    expect(loginArgs("claude auth login")).toEqual(["auth", "login"])
    expect(loginArgs("cursor-agent login")).toEqual(["login"])
    expect(loginArgs("gemini")).toEqual([])
  })
})

describe("needsRealTerminal", () => {
  it("covers the CLIs that proved they need a TTY", () => {
    expect(TERMINAL_ONLY_LOGIN.has("hermes")).toBe(true)
    expect(needsRealTerminal("hermes", "hermes setup")).toBe(true)
  })

  it("treats a bare binary as a TUI launch, not a login", () => {
    expect(needsRealTerminal("gemini", "gemini")).toBe(true)
    // Registry-supplied and unknown to the launcher — still a bare TUI.
    expect(needsRealTerminal("copilot", "copilot")).toBe(true)
  })

  it("lets the piped CLIs through", () => {
    expect(needsRealTerminal("claude", "claude auth login")).toBe(false)
    expect(needsRealTerminal("cursor", "cursor-agent login")).toBe(false)
    expect(needsRealTerminal("amp", "amp login")).toBe(false)
    expect(needsRealTerminal("cline", "cline auth")).toBe(false)
  })
})

// The in-app login shipped broken on Windows: `installer.which("claude")`
// returns C:\...\claude with NO extension (npm writes an extensionless Git-Bash
// script alongside claude.cmd and claude.ps1), CreateProcess can't run it, the
// spawn failed instantly and every Windows user was handed the terminal window
// this feature exists to avoid. These cases can't run on the machine the bug
// appears on, so the platform and the file check are injected.
describe("windowsExecutable", () => {
  const win = (bin: string, present: string[] = []) =>
    windowsExecutable(bin, "win32", (p) => present.includes(p))

  it("leaves other platforms completely alone", () => {
    expect(windowsExecutable("/usr/local/bin/claude", "darwin")).toEqual({
      command: "/usr/local/bin/claude",
      shell: false,
    })
  })

  it("picks the .cmd shim sitting next to the extensionless script", () => {
    expect(win("C:\\nvm4w\\nodejs\\claude", ["C:\\nvm4w\\nodejs\\claude.cmd"])).toEqual(
      { command: '"C:\\nvm4w\\nodejs\\claude.cmd"', shell: true },
    )
  })

  it("quotes the path, because plenty of people are C:\\Users\\First Last", () => {
    const { command } = win("C:\\Users\\First Last\\bin\\claude", [
      "C:\\Users\\First Last\\bin\\claude.cmd",
    ])
    expect(command).toBe('"C:\\Users\\First Last\\bin\\claude.cmd"')
  })

  it("runs a real .exe directly — no shell, no quoting needed", () => {
    expect(win("C:\\tools\\cursor-agent.exe")).toEqual({
      command: "C:\\tools\\cursor-agent.exe",
      shell: false,
    })
  })

  it("sends an already-.cmd path through the shell (Node won't spawn it directly)", () => {
    expect(win("C:\\bin\\amp.cmd")).toEqual({
      command: '"C:\\bin\\amp.cmd"',
      shell: true,
    })
  })

  it("prefers .cmd over .exe when both are present", () => {
    const { command } = win("C:\\bin\\x", ["C:\\bin\\x.cmd", "C:\\bin\\x.exe"])
    expect(command).toBe('"C:\\bin\\x.cmd"')
  })

  it("falls back to the shell rather than a spawn that cannot work", () => {
    expect(win("C:\\bin\\mystery")).toEqual({
      command: '"C:\\bin\\mystery"',
      shell: true,
    })
  })
})
