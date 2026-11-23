#!/usr/bin/env node
// Fails the build when the Workspace bundle the installer ships is missing.
//
// The bundle is copied into the installer as an extraResource, and the app
// starts without it — so nothing else stops a release going out with no
// Workspace in it. Runs at the end of `build:workspace`, locally and in CI.
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const dir = join(repo, "workspace", "frontend", "dist-desktop")
const assets = join(dir, "assets")

const errors = []
if (!existsSync(join(dir, "index.html"))) {
  errors.push(`${dir}: no index.html`)
}
if (!existsSync(assets) || !readdirSync(assets).some((f) => f.endsWith(".js"))) {
  errors.push(`${assets}: no JavaScript bundle`)
}
// Which build this is. Without it the installed launcher cannot tell whether a
// downloaded Workspace update is newer than what it shipped (bundle-ota).
// The same rules as parseBundleInfo in src/main/bundle-ota/manifest.ts: a file
// the launcher cannot parse reads as "no info", and then any download beats
// the shipped bundle however old it is.
try {
  const info = JSON.parse(readFileSync(join(dir, "bundle-info.json"), "utf-8"))
  const positive = (v) => Number.isSafeInteger(v) && v > 0
  if (info.schema !== 1) errors.push(`${dir}/bundle-info.json: schema must be 1`)
  if (typeof info.version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z._-]{0,79}$/.test(info.version)) {
    errors.push(`${dir}/bundle-info.json: version must be a folder-safe name`)
  }
  if (typeof info.commit !== "string" || info.commit.length > 80) errors.push(`${dir}/bundle-info.json: bad commit`)
  if (!positive(info.committedAt)) errors.push(`${dir}/bundle-info.json: committedAt must be a positive integer`)
  if (!Number.isSafeInteger(info.minHostApi) || info.minHostApi < 0) errors.push(`${dir}/bundle-info.json: bad minHostApi`)
} catch (e) {
  errors.push(`${dir}/bundle-info.json: ${e.message}`)
}

if (errors.length) {
  console.error("Workspace desktop bundle is missing or incomplete:")
  for (const e of errors) console.error(`  ${e}`)
  console.error("Build it with: npm --prefix workspace/frontend run build:desktop")
  process.exit(1)
}
console.log(`Workspace desktop bundle OK: ${dir}`)
