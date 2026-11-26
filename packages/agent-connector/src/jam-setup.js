'use strict';

/**
 * `agn jam setup`: install the OpenAgents Jam skill into this computer's
 * agents, so a person can say "start a jam" (or /openagents-jam) instead of
 * pasting the instruction link.
 *
 * The skill only points the agent at the server's current instructions
 * ({endpoint}/jam), so it never goes stale. It comes from the server
 * ({endpoint}/jam/skill.md) with that server's own address filled in, which
 * keeps self-hosted servers working (--endpoint).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const SKILL_NAME = 'openagents-jam';
const DEFAULT_ENDPOINT = 'https://workspace-endpoint.openagents.org';

/** Skill folders of agents that read SKILL.md. Claude Code always; others when installed. */
function skillTargets(home = os.homedir()) {
  return [
    { agent: 'Claude Code', root: path.join(home, '.claude'), dir: path.join(home, '.claude', 'skills'), always: true },
    { agent: 'Codex', root: path.join(home, '.codex'), dir: path.join(home, '.codex', 'skills') },
    { agent: 'OpenCode', root: path.join(home, '.config', 'opencode'), dir: path.join(home, '.config', 'opencode', 'skills') },
  ];
}

function fallbackSkill(endpoint) {
  return `---
name: ${SKILL_NAME}
description: Share this agent with teammates through an OpenAgents jam, a link where they can read the conversation and ask this agent for help without an account. Use when the person says "start a jam", "share this agent", "share you with my team", "let my teammates use you", or similar.
---

# OpenAgents Jam

When the person asks to start a jam or to share you with their team:

1. Fetch the current instructions from \`${endpoint}/jam\` (with your web fetch tool, or \`curl -sS ${endpoint}/jam\`).
2. Follow them step by step. They explain what sharing does, have you draft the share for the person's approval, and only then publish it and start the shared copy of you.

Rules:
- Never publish anything before the person clearly approves the draft.
- If the instructions can't be fetched, tell the person and stop. Don't guess the API.
`;
}

async function fetchSkill(endpoint, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`${endpoint}/jam/skill.md`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const text = await res.text();
      if (text.startsWith('---\n') && text.includes(`name: ${SKILL_NAME}`)) return { text, fromServer: true };
    }
  } catch {}
  return { text: fallbackSkill(endpoint), fromServer: false };
}

async function setup({ endpoint = DEFAULT_ENDPOINT, home = os.homedir(), fetchImpl } = {}) {
  endpoint = String(endpoint).replace(/\/+$/, '');
  const { text, fromServer } = await fetchSkill(endpoint, fetchImpl);
  const installed = [];
  for (const t of skillTargets(home)) {
    if (!t.always && !fs.existsSync(t.root)) continue;
    const folder = path.join(t.dir, SKILL_NAME);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'SKILL.md'), text);
    installed.push({ agent: t.agent, file: path.join(folder, 'SKILL.md') });
  }
  return { endpoint, installed, fromServer };
}

function remove({ home = os.homedir() } = {}) {
  const removed = [];
  for (const t of skillTargets(home)) {
    const folder = path.join(t.dir, SKILL_NAME);
    if (fs.existsSync(folder)) {
      fs.rmSync(folder, { recursive: true, force: true });
      removed.push({ agent: t.agent, folder });
    }
  }
  return { removed };
}

module.exports = { setup, remove, skillTargets, fallbackSkill, SKILL_NAME, DEFAULT_ENDPOINT };
