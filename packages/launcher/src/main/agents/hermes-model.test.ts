// @vitest-environment node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readHermesModel } from "./hermes-model"

describe("the model Hermes actually reads", () => {
  let home: string
  let root: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-model-display-"))
    root = path.join(home, ".hermes")
    fs.mkdirSync(root)
  })
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

  const read = (env: NodeJS.ProcessEnv = {}) => readHermesModel({ homeDir: home, platform: "linux", env })
  const write = (dir: string, config: string): void => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "config.yaml"), config)
  }

  it("prefers the selected agent model over the shared native default", () => {
    write(root, "model:\n  default: gpt-6-astra\n  provider: openai-codex\n")
    expect(read({ LLM_MODEL: " gpt-5.6-sol " })).toBe("gpt-5.6-sol")
    expect(fs.readFileSync(path.join(root, "config.yaml"), "utf-8")).toBe("model:\n  default: gpt-6-astra\n  provider: openai-codex\n")
  })

  it("shows an explicit model even when the native config is missing or the CLI runs in WSL", () => {
    expect(read({ LLM_MODEL: "agent-model" })).toBe("agent-model")
    expect(readHermesModel({ homeDir: home, env: { LLM_MODEL: "wsl-model" }, binary: "wsl:/home/u/hermes" })).toBe("wsl-model")
  })

  it("falls back to the native model when the selection is empty", () => {
    write(root, "model: native-default\n")
    expect(read({ LLM_MODEL: " " })).toBe("native-default")
  })

  it("uses only Hermes model variables in the same order as its adapter", () => {
    write(root, "model: native-default\n")
    expect(read({ HERMES_MODEL: "hermes-model", LLM_MODEL: "generic-model" })).toBe("hermes-model")
    expect(read({ ANTHROPIC_MODEL: "unrelated-model" })).toBe("native-default")
  })

  it.each([
    { OPENAGENTS_AUTH_MODE: "cli_login" },
    { OPENAGENTS_MODEL_MODE: "default" },
    { LLM_API_KEY: "own-key" },
    { OPENAI_API_KEY: "own-key" },
  ])("does not inherit a type model for an isolated instance %j", (instanceEnv) => {
    write(root, "model: native-default\n")
    const options = { homeDir: home, platform: "linux" as const, env: {}, typeEnv: { LLM_MODEL: "type-model" }, instanceEnv }
    expect(readHermesModel(options)).toBe("native-default")
    expect(readHermesModel({ ...options, instanceEnv: { ...instanceEnv, LLM_MODEL: "own-model" } })).toBe("own-model")
  })

  it("resolves process, type and instance models in launch order", () => {
    const options = { homeDir: home, env: { LLM_MODEL: "process-model" }, typeEnv: { LLM_MODEL: "type-model" } }
    expect(readHermesModel(options)).toBe("type-model")
    expect(readHermesModel({ ...options, instanceEnv: { LLM_MODEL: "own-model" } })).toBe("own-model")
    expect(readHermesModel({ ...options, instanceEnv: { OPENAGENTS_AUTH_MODE: "cli_login" } })).toBe("process-model")
  })

  it.each([
    ['model: "native-default"\n', "native-default"],
    ['model: {name: "native:model#1", api_key: "private"} # comment\n', "native:model#1"],
    ["model:\n  default: ''\n  name: fallback-model\n", "fallback-model"],
    ["model: {model: configured-model, name: stale-name}\n", "configured-model"],
    ["model: {default: {model: nested-model, provider: openai-codex}}\n", "nested-model"],
    ["model: {model: {default: nested-default}}\n", "nested-default"],
  ])("reads supported native YAML model shapes", (config, expected) => {
    write(root, config)
    expect(read()).toBe(expected)
  })

  it("follows the Windows native home when HERMES_HOME is unset", () => {
    const local = path.join(home, "AppData", "Local")
    write(path.join(local, "hermes"), "model: windows-model\n")
    expect(readHermesModel({ homeDir: home, platform: "win32", env: { LOCALAPPDATA: local } })).toBe("windows-model")
  })

  it("expands the home and environment variables in HERMES_HOME like Hermes", () => {
    write(root, "model: expanded-home-model\n")
    expect(read({ HERMES_HOME: "~/.hermes" })).toBe("expanded-home-model")
    expect(read({ HERMES_HOME: "$HERMES_DATA/.hermes", HERMES_DATA: home })).toBe("expanded-home-model")
    expect(read({ HERMES_HOME: "${HERMES_DATA}/.hermes", HERMES_DATA: home })).toBe("expanded-home-model")
    expect(readHermesModel({ homeDir: home, platform: "win32", env: { HERMES_HOME: "%USERPROFILE%/.hermes", USERPROFILE: home } })).toBe("expanded-home-model")
  })

  it("follows the active profile in a custom Hermes home", () => {
    const custom = path.join(home, "custom-hermes")
    write(custom, "model: root-model\n")
    write(path.join(custom, "profiles", "work"), "model: work-model\n")
    fs.writeFileSync(path.join(custom, "active_profile"), "work\n")
    expect(read({ HERMES_HOME: custom })).toBe("work-model")
    // A specific home wins over the sticky profile, just as the CLI does.
    write(path.join(custom, "profiles", "pinned"), "model: pinned-model\n")
    expect(read({ HERMES_HOME: path.join(custom, "profiles", "pinned") })).toBe("pinned-model")
  })

  it("uses the named profile selected by the Hermes adapter", () => {
    write(root, "model: root-model\n")
    write(path.join(root, "profiles", "agent-one"), "model: named-model\n")
    expect(readHermesModel({ homeDir: home, platform: "linux", env: {}, agentName: "agent-one" })).toBe("named-model")
  })

  it("observes native model changes without an app restart", () => {
    write(root, "model: first-model\n")
    expect(read()).toBe("first-model")
    write(root, "model: second-model\n")
    expect(read()).toBe("second-model")
  })

  it("returns no model when neither an override nor a valid native default exists", () => {
    expect(read()).toBeNull()
    write(root, "model: [invalid\n")
    expect(read()).toBeNull()
  })

  it("does not describe a WSL Hermes using the unrelated Windows config", () => {
    write(root, "model: native-windows-model\n")
    expect(readHermesModel({ homeDir: home, platform: "linux", env: {}, binary: "wsl:/home/u/.local/bin/hermes" })).toBeNull()
  })
})
