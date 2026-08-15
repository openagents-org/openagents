#!/usr/bin/env node
// Guards the release notes shown in the launcher's "What's new" dialog.
//
// Run bare (`npm run check:changelog`) it validates the shape of every file in
// changelog/. Given a tag (`--tag launcher-v0.9.9`, which is what CI passes) it
// also insists that this exact version has notes and that package.json agrees
// with the tag — the two ways a release quietly ships with nothing to announce.
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const dir = join(root, "changelog")
const TYPES = new Set(["feature", "improvement", "fix"])

const errors = []
const fail = (file, msg) => errors.push(`${file}: ${msg}`)

function isText(v) {
  return typeof v === "string" && v.trim().length > 0
}

function checkFile(name) {
  const version = name.replace(/\.json$/, "")
  let doc
  try {
    doc = JSON.parse(readFileSync(join(dir, name), "utf-8"))
  } catch (e) {
    fail(name, `not valid JSON — ${e.message}`)
    return
  }
  if (doc.version !== version) {
    fail(name, `"version" is "${doc.version}", expected "${version}"`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.date || "")) {
    fail(name, `"date" must be YYYY-MM-DD, got ${JSON.stringify(doc.date)}`)
  }
  if (!Array.isArray(doc.entries) || doc.entries.length === 0) {
    fail(name, '"entries" must be a non-empty array')
    return
  }
  doc.entries.forEach((entry, i) => {
    const at = `entries[${i}]`
    if (!TYPES.has(entry?.type)) {
      fail(name, `${at}.type must be one of ${[...TYPES].join(", ")}`)
    }
    // Both languages are required everywhere: a missing zh silently shows
    // English to every Chinese user, which is the failure nobody notices.
    for (const lang of ["en", "zh"]) {
      if (!isText(entry?.title?.[lang])) {
        fail(name, `${at}.title.${lang} is missing or empty`)
      }
      // description is optional, but half a translation is not.
      if (entry?.description && !isText(entry.description[lang])) {
        fail(name, `${at}.description.${lang} is missing or empty`)
      }
    }
  })
}

let files = []
try {
  files = readdirSync(dir).filter((f) => f.endsWith(".json"))
} catch {
  console.error(`No changelog directory at ${dir}`)
  process.exit(1)
}
if (files.length === 0) errors.push("changelog/: no release notes at all")
files.forEach(checkFile)

const tagArg = process.argv.indexOf("--tag")
if (tagArg !== -1) {
  const tag = process.argv[tagArg + 1] || ""
  const version = tag.replace(/^launcher-v/, "")
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"))
  if (pkg.version !== version) {
    errors.push(
      `package.json version is ${pkg.version}, but the tag says ${version}`,
    )
  }
  if (!files.includes(`${version}.json`)) {
    errors.push(
      `changelog/${version}.json is missing — every released version needs ` +
        `release notes (see changelog/README.md)`,
    )
  }
}

if (errors.length > 0) {
  console.error("Release notes check failed:")
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
console.log(`Release notes OK (${files.length} version(s)).`)
