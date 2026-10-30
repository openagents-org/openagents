"use strict"

/**
 * What the run leaves behind: a table on the terminal for whoever is watching,
 * results.json for whatever collects the daily status, and summary.md to paste
 * into an issue when a cell goes red.
 */

const path = require("path")

const { renderTable, formatDuration, writeFileSafe } = require("./util")

const MARK = { pass: "PASS", fail: "FAIL", skip: "SKIP" }

function summarize(results) {
  return {
    total: results.length,
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    skip: results.filter((r) => r.status === "skip").length,
  }
}

/** The step that ended the run for this agent — the useful half of a failure. */
function failedStep(result) {
  const step = (result.steps || []).find((s) => s.status === "fail")
  return step ? step.name : null
}

function detailOf(result) {
  if (result.status === "pass") {
    return result.reply ? JSON.stringify(String(result.reply).slice(0, 60)) : ""
  }
  const step = failedStep(result)
  const reason = String(result.reason || "")
    .split("\n")[0]
    .slice(0, 90)
  return step ? `${step}: ${reason}` : reason
}

function renderConsole(run) {
  const counts = summarize(run.results)
  const rows = run.results.map((r) => [
    r.type,
    MARK[r.status] || r.status,
    formatDuration(r.durationMs),
    detailOf(r),
  ])
  return [
    "",
    renderTable(["AGENT", "STATUS", "TIME", "DETAIL"], rows),
    "",
    `${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped ` +
      `in ${formatDuration(run.durationMs)} ` +
      `(${run.platform}/${run.arch}, launcher ${run.launcherVersion || "?"})`,
  ].join("\n")
}

function renderMarkdown(run) {
  const counts = summarize(run.results)
  const lines = [
    `# Launcher end-to-end — ${run.startedAt}`,
    "",
    `- Host: \`${run.platform}/${run.arch}\``,
    `- Launcher: \`${run.launcherVersion || "?"}\` (core \`${run.coreVersion || "?"}\`)`,
    `- Workspace: \`${run.workspace.slug || run.workspace.id}\``,
    `- Result: **${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped** in ${formatDuration(run.durationMs)}`,
    "",
    "| Agent | Status | Time | Detail |",
    "| --- | --- | --- | --- |",
  ]
  for (const r of run.results) {
    lines.push(
      `| ${r.type} | ${MARK[r.status] || r.status} | ${formatDuration(r.durationMs)} | ${detailOf(r).replace(/\|/g, "\\|")} |`,
    )
  }
  const failures = run.results.filter((r) => r.status === "fail")
  if (failures.length) {
    lines.push("", "## Failures", "")
    for (const r of failures) {
      lines.push(
        `### ${r.type} (${failedStep(r) || "?"})`,
        "",
        "```",
        String(r.reason || ""),
        "```",
        "",
      )
      lines.push(
        ...(r.steps || []).map(
          (s) =>
            `- ${s.name}: ${s.status} (${formatDuration(s.durationMs)})${s.detail ? ` — ${String(s.detail).split("\n")[0]}` : ""}`,
        ),
        "",
      )
    }
  }
  return lines.join("\n")
}

function writeArtifacts(run, outDir, redact) {
  const jsonPath = path.join(outDir, "results.json")
  const mdPath = path.join(outDir, "summary.md")
  writeFileSafe(jsonPath, redact(JSON.stringify(run, null, 2)))
  writeFileSafe(mdPath, redact(renderMarkdown(run)))
  return { jsonPath, mdPath }
}

module.exports = { summarize, renderConsole, renderMarkdown, writeArtifacts }
