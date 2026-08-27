"use strict"

/** Small shared helpers. No dependencies — this suite runs with bare node. */

const fs = require("fs")
const path = require("path")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** "4m12s" / "38s" — durations in a results table are read, not computed. */
function formatDuration(ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
}

/**
 * Hide every secret this run knows about in `text`.
 *
 * Logs and daemon output are written to disk and pasted into chat when a run
 * fails, and both can echo an API key back verbatim.
 */
function makeRedactor(secrets) {
  const values = [
    ...new Set(secrets.filter((s) => typeof s === "string" && s.length >= 8)),
  ]
  values.sort((a, b) => b.length - a.length)
  return (text) => {
    if (!text) return text
    let out = String(text)
    for (const v of values) out = out.split(v).join("***")
    return out
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeFileSafe(file, contents) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, contents)
}

/** Fixed-width text table — the run summary on a terminal with no deps. */
function renderTable(headers, rows) {
  const all = [headers, ...rows]
  const widths = headers.map((_, i) =>
    Math.max(...all.map((r) => String(r[i] ?? "").length)),
  )
  const line = (cells) =>
    cells
      .map((c, i) => String(c ?? "").padEnd(widths[i]))
      .join("  ")
      .trimEnd()
  return [
    line(headers),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map(line),
  ].join("\n")
}

module.exports = {
  sleep,
  formatDuration,
  nowStamp,
  makeRedactor,
  ensureDir,
  writeFileSafe,
  renderTable,
}
