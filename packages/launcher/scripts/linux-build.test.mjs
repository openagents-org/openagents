import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const { build, scripts } = require("../package.json")
const { createYargs, configureBuildCommand, normalizeOptions } = require("electron-builder/out/builder")
const { computeArchToTargetNamesMap } = require("app-builder-lib/out/targets/targetFactory")
const { Platform } = require("app-builder-lib")
const { Arch } = require("builder-util")

function withHost(platform, arch, check) {
  const descriptors = Object.getOwnPropertyDescriptors(process)
  try {
    Object.defineProperty(process, "platform", { ...descriptors.platform, value: platform })
    Object.defineProperty(process, "arch", { ...descriptors.arch, value: arch })
    check()
  } finally {
    Object.defineProperty(process, "platform", descriptors.platform)
    Object.defineProperty(process, "arch", descriptors.arch)
  }
}

// Parse the real npm commands using electron-builder's CLI parser, then apply
// its actual target-resolution logic. Bare --arm64 is not sufficient when the
// configured Linux targets pin x64; explicit target names override that config.
function resolveScript(name) {
  const prefix = "npm run build && electron-builder "
  assert(scripts[name].startsWith(prefix), `Unexpected build command: ${name}`)
  const args = scripts[name].slice(prefix.length).trim().split(/\s+/)
  const options = normalizeOptions(configureBuildCommand(createYargs()).parseSync(args))
  return new Map([...options.targets].map(([platform, raw]) => [
    platform,
    [...computeArchToTargetNamesMap(raw, {
      platformSpecificBuildOptions: build[platform.buildConfigurationKey],
    }, platform)],
  ]))
}

for (const platform of ["linux", "darwin", "win32"]) {
  for (const hostArch of ["x64", "arm64"]) {
    const host = `${platform}/${hostArch}`
    for (const script of ["build:linux", "build:all"]) {
      test(`${script} preserves Linux x64 on ${host}`, () => {
        withHost(platform, hostArch, () => {
          assert.deepEqual(resolveScript(script).get(Platform.LINUX), [[Arch.x64, ["AppImage", "deb"]]])
        })
      })
    }
    for (const arch of ["x64", "arm64"]) {
      test(`build:linux:${arch} builds only ${arch} installers on ${host}`, () => {
        withHost(platform, hostArch, () => {
          assert.deepEqual([...resolveScript(`build:linux:${arch}`)], [
            [Platform.LINUX, [[Arch[arch], ["AppImage", "deb"]]]],
          ])
        })
      })
    }
    test(`dist preserves configured targets on ${host}`, () => {
      withHost(platform, hostArch, () => {
        const targetPlatform = Platform.current()
        const expected = platform === "linux"
          ? [[Arch.x64, ["AppImage", "deb"]]]
          : platform === "darwin"
            ? [[Arch[hostArch], ["dmg", "zip"]]]
            : [[Arch.x64, ["nsis", "msi", "portable"]]]
        assert.deepEqual([...resolveScript("dist")], [[targetPlatform, expected]])
      })
    })
  }
}
