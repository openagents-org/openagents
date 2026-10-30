#!/usr/bin/env node
// Fails the build when the Workspace bundle the installer ships is missing.
//
// The bundle is copied into the installer as an extraResource, and the app
// starts without it — so nothing else stops a release going out with no
// Workspace in it. Runs at the end of `build:workspace`, locally and in CI.
import { existsSync, readdirSync } from "node:fs"
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

if (errors.length) {
  console.error("Workspace desktop bundle is missing or incomplete:")
  for (const e of errors) console.error(`  ${e}`)
  console.error("Build it with: npm --prefix workspace/frontend run build:desktop")
  process.exit(1)
}
console.log(`Workspace desktop bundle OK: ${dir}`)
