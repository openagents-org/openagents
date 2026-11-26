---
name: openagents-jam
description: Share this agent with teammates through an OpenAgents jam, a link where they can read the conversation and ask this agent for help without an account. Use when the person says "start a jam", "share this agent", "share you with my team", "let my teammates use you", or similar.
---

# OpenAgents Jam

When the person asks to start a jam or to share you with their team:

1. Fetch the current instructions from `{JAM}` (with your web fetch tool, or `curl -sS {JAM}`).
2. Follow them step by step. They explain what sharing does, have you draft the share for the person's approval, and only then publish it and start the shared copy of you.

Rules:
- Never publish anything before the person clearly approves the draft.
- If the instructions can't be fetched, tell the person and stop. Don't guess the API.

OpenAgents server: `{API}`. For a self-hosted OpenAgents, reinstall the skill with `npx -y {LAUNCHER} jam setup --endpoint <your server>`.
