"""
Shared workspace prompt builder for all adapters.

Generates system prompt sections that teach agents about:
- Their identity and workspace context
- Multi-agent collaboration (@mention delegation)
- Workspace REST API skills (files, browser, tunnels)

Claude gets these as context alongside MCP tools.
Non-MCP agents (OpenClaw, Codex) get these as actionable API
instructions they can call via curl/requests/fetch.
"""

from typing import Optional


def build_browser_directive(browser_enabled: bool) -> str:
    """Strong directive forcing agents to use the workspace browser when the
    workspace has Browser Fabric enabled.

    Emitted high in the system prompt so it wins against any earlier guidance
    that suggests local browsing tools. Empty string when the workspace toggle
    is off so older agents continue to behave as before.

    Returns "" when the toggle is off; the caller can unconditionally
    concatenate the result.
    """
    if not browser_enabled:
        return ""
    return (
        "\n## Browser Use (MANDATORY)\n"
        "This workspace has the **shared Browser Fabric session** enabled. "
        "All web browsing MUST go through the workspace tools so the user can "
        "watch the session live in their right-side panel and so cookies / "
        "state persist across agents.\n\n"
        "**To READ a web page, ALWAYS use `mcp__openagents-workspace__workspace_fetch_url` first.** "
        "It handles JavaScript-heavy pages (Notion, SPAs) automatically and does "
        "not consume a shared browser tab. Only open a shared browser tab when "
        "you need to interact with the page (click, type, log in) or when "
        "workspace_fetch_url reports AUTH_REQUIRED / BOT_CHALLENGE — in that "
        "case open the URL in a tab and ask a human to complete the login in "
        "the live view.\n\n"
        "**Tools for interactive browsing:**\n"
        "- `mcp__openagents-workspace__workspace_browser_open`\n"
        "- `mcp__openagents-workspace__workspace_browser_navigate`\n"
        "- `mcp__openagents-workspace__workspace_browser_click`\n"
        "- `mcp__openagents-workspace__workspace_browser_type`\n"
        "- `mcp__openagents-workspace__workspace_browser_snapshot`\n"
        "- `mcp__openagents-workspace__workspace_browser_screenshot`\n"
        "- `mcp__openagents-workspace__workspace_browser_list_tabs`\n"
        "- `mcp__openagents-workspace__workspace_browser_close`\n"
        "\n"
        "Shared browser tabs are a limited per-workspace resource: close your "
        "tab (`workspace_browser_close`) as soon as you are done with it. Idle "
        "tabs are auto-closed after a few minutes.\n\n"
        "If you don't have these MCP tools, use `Bash` + `curl` against "
        "`/v1/fetch` and `/v1/browser/tabs` (documented below in Shared Browser).\n\n"
        "**FORBIDDEN — do NOT call any of these:**\n"
        "- `mcp__browsermcp__*` (any local Browser MCP extension tool)\n"
        "- `mcp__playwright__*`, `mcp__puppeteer__*`, `mcp__chrome-devtools__*`, or any other local-browser MCP\n"
        "- `WebFetch` / `web_fetch` — it cannot render JavaScript and fails on "
        "many pages; use `workspace_fetch_url` instead\n"
        "\n"
        "`WebSearch` / `web_search` (pure search, no page fetching) IS allowed — "
        "but read the result URLs with `workspace_fetch_url`, not WebFetch.\n\n"
        "If a local browser tool errors with \"extension isn't connected\" or "
        "\"connect your browser\", do NOT ask the user to connect anything — "
        "the local extension is irrelevant here. Immediately switch to the "
        "workspace browser tools above. The Browser Fabric session is already "
        "running on the backend.\n"
    )


def build_workspace_identity(
    agent_name: str,
    workspace_id: str,
    channel_name: str,
    mode: str = "execute",
) -> str:
    """Build the identity section common to all adapters."""
    return (
        f"You are agent '{agent_name}' connected to an OpenAgents workspace.\n"
        f"Your text responses are automatically posted to the workspace chat "
        f"— just write your answer naturally.\n\n"
        f"## Workspace Context\n"
        f"- Workspace ID: {workspace_id}\n"
        f"- Channel: {channel_name}\n"
        f"- Mode: {mode}\n"
    )


def build_collaboration_prompt() -> str:
    """Build the multi-agent collaboration instructions."""
    return (
        "\n## Multi-Agent Collaboration\n"
        "To delegate work to another agent, @mention them in your response. "
        "Only @mentioned agents will receive the message.\n\n"
        "IMPORTANT: Do NOT @mention an agent just to say thanks or acknowledge "
        "— that wakes them up for nothing. Only @mention when you need them "
        "to do work. When the task is complete, report results to the user "
        "without @mentioning other agents.\n\n"
        "To discover available agents, use the workspace discover endpoint "
        "or the workspace_get_agents tool (if available).\n"
    )


def build_phase_gate_directive(
    role: Optional[str],
    owner: Optional[str] = None,
    endpoint: Optional[str] = None,
    workspace_id: Optional[str] = None,
    channel_name: Optional[str] = None,
) -> str:
    """Per-message directive for a channel that is still clarifying.

    The backend's phase gate (``_apply_phase_gate`` in workspace_mod.py)
    decides who may be woken; this is what makes the wake-up safe — an agent
    consulted mid-clarification answers the question instead of building
    against a specification that isn't settled.

    ``role`` comes from the routed message's metadata: ``"owner"`` (holds the
    floor), ``"plan"`` (mentioned, must not build), anything else (phase is
    active but this agent is neither). Returns "" when there is nothing to
    say, so callers can concatenate unconditionally.

    Mirrors ``buildPhaseGateDirective`` in
    packages/agent-connector/src/adapters/workspace-prompt.js.
    """
    if not role:
        return ""
    who = owner or "the phase owner"

    if role == "owner":
        patch = ""
        if endpoint and workspace_id and channel_name:
            base = endpoint.rstrip("/")
            patch = (
                f' (no such tool? PATCH {base}/v1/workspaces/{workspace_id}'
                f'/channels/{channel_name} with {{"phase":"building"}} and your '
                "X-Workspace-Token header)"
            )
        return (
            "\n\n---\n"
            "[Workspace phase: CLARIFYING — you own this phase]\n"
            "The requirement in this channel is not settled yet, and settling it "
            "is your job. Ask what is still open, confirm your understanding, and "
            "record what the user agrees to. While this phase is active no other "
            "agent can start implementing — they can only be consulted.\n"
            "Once the user has confirmed the requirement, advance the phase: call "
            f'`workspace_set_phase` with phase="building"{patch}. '
            "Nobody can start building until you do, so do not leave it behind — "
            "but do not advance it on your own judgement either; wait for the user.\n"
        )

    if role == "plan":
        return (
            "\n\n---\n"
            "[Workspace phase: CLARIFYING — answer in PLAN mode]\n"
            f"You were @mentioned while {who} is still clarifying the requirement, "
            "so answer what was actually asked: feasibility, risks, options, rough "
            "effort, or questions of your own that need answering before this can "
            "be built.\n"
            "Do NOT start the work — no code, no file edits, no commands that "
            "change anything. The specification is not final, so anything built "
            f"now would be built on guesses. {who} advances the phase once the "
            "requirement is confirmed, and implementation starts then.\n"
        )

    return (
        "\n\n---\n"
        f"[Workspace phase: CLARIFYING — owned by {who}]\n"
        "The requirement in this channel is still being clarified. Keep your "
        "reply to what helps settle it, and leave implementation until the "
        "phase advances.\n"
    )


def build_mode_prompt(mode: str) -> str:
    """Build mode-specific instructions."""
    if mode == "plan":
        return (
            "\n## Mode: PLAN\n"
            "You are in PLAN mode. Only read, analyze, and propose.\n"
            "- Do NOT write code, make changes, or execute actions.\n"
            "- Outline your plan step by step.\n"
            "- Describe what changes you would make and why.\n"
            "- Ask clarifying questions if needed.\n"
            "- When the user is satisfied, they can switch you to Execute mode.\n"
        )
    return (
        "\n## Mode: EXECUTE\n"
        "You are in EXECUTE mode. You can write code, make changes, "
        "and take actions.\n"
        "Be helpful, concise, and direct. Use markdown formatting.\n"
    )


def build_api_skills_prompt(
    endpoint: str,
    workspace_id: str,
    token: str,
    agent_name: str,
    channel_name: str,
    disabled_modules: Optional[set] = None,
    mode: str = "execute",
) -> str:
    """Build REST API skill instructions for non-MCP agents.

    These teach the agent how to interact with workspace resources
    (files, browser, tunnels) by calling HTTP endpoints directly.

    In plan mode, only read-only operations are documented.
    """
    _disabled = disabled_modules or set()
    base_url = endpoint.rstrip("/")
    is_plan = mode == "plan"
    h = f"X-Workspace-Token: {token}"

    sections = []

    # ── Capabilities preamble ──
    caps = []
    if "files" not in _disabled:
        caps.append("share and read files with other agents and users")
    if "search" not in _disabled:
        caps.append("search the web for images and post them into the chat")
    if "browser" not in _disabled:
        caps.append("browse websites in a shared browser")
    caps.append("discover other agents in the workspace")

    sections.append(
        "## Workspace Tools (MANDATORY)\n\n"
        "You can " + ", ".join(caps) + ".\n"
        "These are WORKSPACE tools shared with all agents and users. "
        "They are different from your native tools.\n\n"
        "**HOW TO USE:** Call your `exec` tool to run the `curl` commands below. "
        "Do NOT output curl commands as text — EXECUTE them with `exec`.\n\n"
        "**IMPORTANT — tool priority:**\n"
        "- ALWAYS use `exec` + `curl` (documented below) for workspace operations.\n"
        "- Do NOT use `workspace_browser_*` native tools — they are not configured "
        "and will fail.\n"
        "- Do NOT use `web_fetch`, `browser`, or any native browsing tool "
        "when the user asks to use the workspace browser — use `exec` + `curl` instead.\n"
        "- The workspace browser is a *shared* browser visible to all users and agents.\n\n"
        "**Auth header** (include on every request):\n"
        f"`X-Workspace-Token: {token}`\n"
    )

    # ── Files ──
    if "files" not in _disabled:
        s = "\n### Shared Files\n\n"

        if not is_plan:
            s += (
                "**To upload a file**, exec this (replace filename/content):\n"
                f'CONTENT=$(echo -n \'YOUR_CONTENT\' | base64) && '
                f'curl -s -X POST {base_url}/v1/files/base64 '
                f'-H "{h}" '
                '-H "Content-Type: application/json" '
                "-d '{\"filename\":\"report.md\","
                "\"content_base64\":\"'\"$CONTENT\"'\","
                "\"content_type\":\"text/markdown\","
                f"\"network\":\"{workspace_id}\","
                f"\"source\":\"openagents:{agent_name}\","
                f"\"channel_name\":\"{channel_name}\"}}'\n\n"
            )

        s += (
            "**List files:**\n"
            f"`curl -s -H \"{h}\" {base_url}/v1/files?network={workspace_id}`\n\n"
            "**Download file:**\n"
            f"`curl -s -H \"{h}\" {base_url}/v1/files/{{file_id}}`\n\n"
            "**File info (metadata):**\n"
            f"`curl -s -H \"{h}\" {base_url}/v1/files/{{file_id}}/info`\n"
        )

        if not is_plan:
            s += (
                "\n**Delete file:**\n"
                f"`curl -s -X DELETE -H \"{h}\" {base_url}/v1/files/{{file_id}}`\n"
            )

        sections.append(s)

    # ── Image search ──
    if "search" not in _disabled:
        s = "\n### Image Search\n\n"
        s += (
            "You CAN find images on the web and show them in the chat.\n\n"
            "**Search images:**\n"
            f"curl -s -X POST {base_url}/v1/search/images "
            f'-H "{h}" -H "Content-Type: application/json" '
            f'-d \'{{"query":"golden gate bridge","network":"{workspace_id}","count":10}}\'\n\n'
            "**To show an image in chat**, embed the result's `image_url` in your reply "
            "as markdown: `![title](image_url)` — it renders inline.\n\n"
        )
        if not is_plan:
            s += (
                "**To keep a copy in the workspace AND post it as an attachment** "
                "(survives external links going dead):\n"
                f"curl -s -X POST {base_url}/v1/files/from_url "
                f'-H "{h}" -H "Content-Type: application/json" '
                f'-d \'{{"url":"IMAGE_URL","network":"{workspace_id}",'
                f'"channel_name":"{channel_name}","source":"openagents:{agent_name}",'
                f'"post_to_channel":true,"caption":"optional message text"}}\'\n\n'
                "Mention the source page when you share images, and never present a "
                "search result as license-free.\n"
            )
        sections.append(s)

    # ── Browser ──
    if "browser" not in _disabled:
        s = "\n### Shared Browser\n\n"

        if not is_plan:
            s += (
                "**To browse a website**, exec these steps (use exec for each):\n"
                f"Step 1 — open tab: "
                f'curl -s -X POST {base_url}/v1/browser/tabs '
                f'-H "{h}" -H "Content-Type: application/json" '
                f'-d \'{{"url":"https://example.com","network":"{workspace_id}",'
                f'"source":"openagents:{agent_name}"}}\'\n'
                f"Step 2 — read content: "
                f'curl -s -H "{h}" {base_url}/v1/browser/tabs/TAB_ID/snapshot\n'
                f"Step 3 — close tab: "
                f'curl -s -X DELETE -H "{h}" {base_url}/v1/browser/tabs/TAB_ID\n'
                f"(Replace TAB_ID with the id from step 1 response)\n\n"
            )

        s += (
            "**List open tabs:**\n"
            f"`curl -s -H \"{h}\" {base_url}/v1/browser/tabs?network={workspace_id}`\n\n"
            "**Get page content (text):**\n"
            f"`curl -s -H \"{h}\" {base_url}/v1/browser/tabs/{{tab_id}}/snapshot`\n\n"
            "**Get screenshot (PNG):**\n"
            f"`curl -s -H \"{h}\" {base_url}/v1/browser/tabs/{{tab_id}}/screenshot`\n"
        )

        if not is_plan:
            s += (
                "\n**Open tab:**\n"
                f"`curl -s -X POST -H \"{h}\" -H \"Content-Type: application/json\""
                f" {base_url}/v1/browser/tabs"
                f" -d '{{\"url\":\"URL\",\"network\":\"{workspace_id}\","
                f"\"source\":\"openagents:{agent_name}\"}}'`\n\n"
                "**Navigate:**\n"
                f"`curl -s -X POST -H \"{h}\" -H \"Content-Type: application/json\""
                f" {base_url}/v1/browser/tabs/{{tab_id}}/navigate"
                f" -d '{{\"url\":\"URL\"}}'`\n\n"
                "**Click element:**\n"
                f"`curl -s -X POST -H \"{h}\" -H \"Content-Type: application/json\""
                f" {base_url}/v1/browser/tabs/{{tab_id}}/click"
                f" -d '{{\"selector\":\"CSS_SELECTOR\"}}'`\n\n"
                "**Type text:**\n"
                f"`curl -s -X POST -H \"{h}\" -H \"Content-Type: application/json\""
                f" {base_url}/v1/browser/tabs/{{tab_id}}/type"
                f" -d '{{\"selector\":\"CSS_SELECTOR\",\"text\":\"TEXT\"}}'`\n\n"
                "**Close tab:**\n"
                f"`curl -s -X DELETE -H \"{h}\" {base_url}/v1/browser/tabs/{{tab_id}}`\n"
            )

        sections.append(s)

    # ── Discovery ──
    sections.append(
        "\n### Discover Agents\n"
        f"`curl -s -H \"{h}\" {base_url}/v1/discover?network={workspace_id}`\n"
    )

    return "\n".join(sections)


def build_claude_system_prompt(
    agent_name: str,
    workspace_id: str,
    channel_name: str,
    mode: str = "execute",
    browser_enabled: bool = False,
) -> str:
    """Build the system prompt for Claude adapter (MCP-based).

    Claude gets identity + collaboration instructions but NOT the full API
    skills section — it uses MCP tools instead. When `browser_enabled` is
    True we still inject the browser directive so the agent knows to prefer
    `workspace_browser_*` over `mcp__browsermcp__*` and other local-browser
    MCPs that might also be installed.
    """
    parts = []
    parts.append(build_workspace_identity(agent_name, workspace_id, channel_name, mode))
    parts.append(
        "Use workspace_get_history to read previous messages.\n"
        "Use workspace_get_agents to see other agents.\n"
    )
    parts.append(build_browser_directive(browser_enabled))
    parts.append(build_collaboration_prompt())

    if mode == "plan":
        parts.append(
            "\nYou are in PLAN mode. Only read, analyze, and propose "
            "changes. Do not make edits.\n"
        )

    parts.append(
        "\nIMPORTANT: Never use AskUserQuestion. "
        "AskUserQuestion blocks the subprocess and will hang the thread. "
        "If you need to ask the user something, just write the question "
        "as your text response.\n"
    )

    return "\n".join(parts)


def build_openclaw_system_prompt(
    agent_name: str,
    workspace_id: str,
    channel_name: str,
    endpoint: str,
    token: str,
    mode: str = "execute",
    disabled_modules: Optional[set] = None,
    browser_enabled: bool = False,
) -> str:
    """Build the full system prompt for OpenClaw/non-MCP agents.

    Includes identity, collaboration, mode instructions, and REST API skills
    for workspace resources. When `browser_enabled` is True, prepends the
    strong directive that forbids local browser MCP tools (e.g. browsermcp,
    playwright) — these agents typically have multiple MCP servers wired and
    pick the wrong one without an explicit prohibition.
    """
    parts = []
    parts.append(build_workspace_identity(agent_name, workspace_id, channel_name, mode))
    parts.append(build_browser_directive(browser_enabled))
    parts.append(build_collaboration_prompt())
    parts.append(build_mode_prompt(mode))
    parts.append(build_api_skills_prompt(
        endpoint=endpoint,
        workspace_id=workspace_id,
        token=token,
        agent_name=agent_name,
        channel_name=channel_name,
        disabled_modules=disabled_modules,
        mode=mode,
    ))
    return "\n".join(parts)


def build_openclaw_skill_md(
    endpoint: str,
    workspace_id: str,
    token: str,
    agent_name: str,
    channel_name: str,
    disabled_modules: Optional[set] = None,
    browser_enabled: bool = False,
) -> str:
    """Build a SKILL.md file for OpenClaw's skill auto-discovery.

    OpenClaw loads SKILL.md files from <workspace>/skills/ and injects
    them into the system prompt. This is the primary way to teach the
    gateway-mode agent about workspace tools (since chat.send only
    accepts the user message, not a system prompt).
    """
    body = build_api_skills_prompt(
        endpoint=endpoint,
        workspace_id=workspace_id,
        token=token,
        agent_name=agent_name,
        channel_name=channel_name,
        disabled_modules=disabled_modules,
        mode="execute",
    )

    identity = build_workspace_identity(
        agent_name, workspace_id, channel_name, "execute"
    )
    directive = build_browser_directive(browser_enabled)
    collab = build_collaboration_prompt()

    frontmatter = (
        "---\n"
        "name: openagents-workspace\n"
        'description: "Share files, browse websites, and collaborate '
        "with other agents in an OpenAgents workspace. Use when: "
        "(1) sharing results or reports with the user or other agents, "
        "(2) browsing a website to gather information, "
        "(3) reading files shared by users or other agents, "
        '(4) checking who else is in the workspace."\n'
        "metadata:\n"
        '  {"openclaw": {"always": true, "emoji": "\\U0001F310"}}\n'
        "---\n\n"
    )

    return frontmatter + identity + directive + "\n" + collab + "\n" + body


def _build_opencode_api_skills_prompt(
    endpoint: str,
    workspace_id: str,
    token: str,
    agent_name: str,
    channel_name: str,
    disabled_modules: Optional[set] = None,
    mode: str = "execute",
) -> str:
    _disabled = disabled_modules or set()
    base_url = endpoint.rstrip("/")
    is_plan = mode == "plan"
    h = f"X-Workspace-Token: {token}"

    sections = []

    # ── Capabilities preamble ──
    caps = []
    if "files" not in _disabled:
        caps.append("share and read files with other agents and users")
    if "search" not in _disabled:
        caps.append("search the web for images and post them into the chat")
    if "browser" not in _disabled:
        caps.append("browse websites in a shared browser")
    caps.append("discover other agents in the workspace")

    sections.append(
        "## Workspace Tools (MANDATORY)\n\n"
        "You can " + ", ".join(caps) + ".\n"
        "These are WORKSPACE tools shared with all agents and users. "
        "They are different from your native tools.\n\n"
        "**HOW TO USE:** Use your `bash` tool to run the `curl` commands below. "
        "Do NOT output curl commands as text — EXECUTE them with `bash`.\n\n"
        "**IMPORTANT — tool priority:**\n"
        "- ALWAYS use `bash` + `curl` (documented below) for workspace operations.\n"
        "- Do NOT use `webfetch` or any native browsing tool "
        "when the user asks to use the workspace browser — use `bash` + `curl` instead.\n"
        "- The workspace browser is a *shared* browser visible to all users and agents.\n\n"
        "**Auth header** (include on every request):\n"
        f"`X-Workspace-Token: {token}`\n"
    )

    # ── Files ──
    if "files" not in _disabled:
        s = "\n### Shared Files\n\n"

        if not is_plan:
            s += (
                "**To upload a file**, run in bash (replace filename/content):\n"
                f"CONTENT=$(echo -n 'YOUR_CONTENT' | base64) && "
                f"curl -s -X POST {base_url}/v1/files/base64 "
                f'-H "{h}" '
                '-H "Content-Type: application/json" '
                '-d \'{"filename":"report.md",'
                '"content_base64":"\'"$CONTENT"\'",'
                '"content_type":"text/markdown",'
                f'"network":"{workspace_id}",'
                f'"source":"openagents:{agent_name}",'
                f'"channel_name":"{channel_name}"}}\'\n\n'
            )

        s += (
            "**List files:**\n"
            f'`curl -s -H "{h}" {base_url}/v1/files?network={workspace_id}`\n\n'
            "**Download file:**\n"
            f'`curl -s -H "{h}" {base_url}/v1/files/{{file_id}}`\n\n'
            "**File info (metadata):**\n"
            f'`curl -s -H "{h}" {base_url}/v1/files/{{file_id}}/info`\n'
        )

        if not is_plan:
            s += (
                "\n**Delete file:**\n"
                f'`curl -s -X DELETE -H "{h}" {base_url}/v1/files/{{file_id}}`\n'
            )

        sections.append(s)

    # ── Image search ──
    if "search" not in _disabled:
        s = "\n### Image Search\n\n"
        s += (
            "You CAN find images on the web and show them in the chat.\n\n"
            "**Search images:**\n"
            f"curl -s -X POST {base_url}/v1/search/images "
            f'-H "{h}" -H "Content-Type: application/json" '
            f'-d \'{{"query":"golden gate bridge","network":"{workspace_id}","count":10}}\'\n\n'
            "**To show an image in chat**, embed the result's `image_url` in your reply "
            "as markdown: `![title](image_url)` — it renders inline.\n\n"
        )
        if not is_plan:
            s += (
                "**To keep a copy in the workspace AND post it as an attachment:**\n"
                f"curl -s -X POST {base_url}/v1/files/from_url "
                f'-H "{h}" -H "Content-Type: application/json" '
                f'-d \'{{"url":"IMAGE_URL","network":"{workspace_id}",'
                f'"channel_name":"{channel_name}","source":"openagents:{agent_name}",'
                f'"post_to_channel":true,"caption":"optional message text"}}\'\n\n'
                "Mention the source page when you share images, and never present a "
                "search result as license-free.\n"
            )
        sections.append(s)

    # ── Browser ──
    if "browser" not in _disabled:
        s = "\n### Shared Browser\n\n"

        if not is_plan:
            s += (
                "**To just READ a page (preferred — no tab needed, handles JS pages):**\n"
                f"curl -s -X POST {base_url}/v1/fetch "
                f'-H "{h}" -H "Content-Type: application/json" '
                f'-d \'{{"url":"https://example.com","network":"{workspace_id}",'
                f'"source":"openagents:{agent_name}"}}\'\n'
                "If it returns error_code AUTH_REQUIRED or BOT_CHALLENGE, open the URL "
                "in a shared tab (below) and share its `live_url` so a human can log in.\n\n"
                "**To browse interactively** (click/type/login), run these steps in bash:\n"
                f"Step 1 — open tab: "
                f"curl -s -X POST {base_url}/v1/browser/tabs "
                f'-H "{h}" -H "Content-Type: application/json" '
                f'-d \'{{"url":"https://example.com","network":"{workspace_id}",'
                f'"source":"openagents:{agent_name}"}}\'\n'
                f"Step 2 — read content: "
                f'curl -s -H "{h}" {base_url}/v1/browser/tabs/TAB_ID/snapshot\n'
                f"Step 3 — close tab: "
                f'curl -s -X DELETE -H "{h}" {base_url}/v1/browser/tabs/TAB_ID\n'
                f"(Replace TAB_ID with the id from step 1 response)\n"
                "Tabs are a limited per-workspace resource — always close yours when done; "
                "idle tabs are auto-closed after a few minutes.\n\n"
            )

        s += (
            "**List open tabs:**\n"
            f'`curl -s -H "{h}" {base_url}/v1/browser/tabs?network={workspace_id}`\n\n'
            "**Get page content (text):**\n"
            f'`curl -s -H "{h}" {base_url}/v1/browser/tabs/{{tab_id}}/snapshot`\n\n'
            "**Get screenshot (PNG):**\n"
            f'`curl -s -H "{h}" {base_url}/v1/browser/tabs/{{tab_id}}/screenshot`\n'
        )

        if not is_plan:
            s += (
                "\n**Open tab:**\n"
                f'`curl -s -X POST -H "{h}" -H "Content-Type: application/json"'
                f" {base_url}/v1/browser/tabs"
                f' -d \'{{"url":"URL","network":"{workspace_id}",'
                f'"source":"openagents:{agent_name}"}}\'`\n\n'
                "**Navigate:**\n"
                f'`curl -s -X POST -H "{h}" -H "Content-Type: application/json"'
                f" {base_url}/v1/browser/tabs/{{tab_id}}/navigate"
                f' -d \'{{"url":"URL"}}\'`\n\n'
                "**Click element:**\n"
                f'`curl -s -X POST -H "{h}" -H "Content-Type: application/json"'
                f" {base_url}/v1/browser/tabs/{{tab_id}}/click"
                f' -d \'{{"selector":"CSS_SELECTOR"}}\'`\n\n'
                "**Type text:**\n"
                f'`curl -s -X POST -H "{h}" -H "Content-Type: application/json"'
                f" {base_url}/v1/browser/tabs/{{tab_id}}/type"
                f' -d \'{{"selector":"CSS_SELECTOR","text":"TEXT"}}\'`\n\n'
                "**Close tab:**\n"
                f'`curl -s -X DELETE -H "{h}" {base_url}/v1/browser/tabs/{{tab_id}}`\n'
            )

        sections.append(s)

    # ── Discovery ──
    sections.append(
        "\n### Discover Agents\n"
        f'`curl -s -H "{h}" {base_url}/v1/discover?network={workspace_id}`\n'
    )

    return "\n".join(sections)


def build_opencode_system_prompt(
    agent_name: str,
    workspace_id: str,
    channel_name: str,
    endpoint: str,
    token: str,
    mode: str = "execute",
    disabled_modules: Optional[set] = None,
    browser_enabled: bool = False,
) -> str:
    parts = []
    parts.append(build_workspace_identity(agent_name, workspace_id, channel_name, mode))

    parts.append(
        "\n## Agent Capabilities\n"
        "You are a terminal-native coding agent powered by OpenCode. "
        "You have built-in tools for file operations (read, edit, write, glob, grep), "
        "shell execution (bash), web fetching (webfetch), and LSP integration.\n\n"
        "Your conversation persists across messages in this workspace channel. "
        "Use your native tools for local work. Use the workspace API (curl via bash) "
        "for sharing files, browsing the web collaboratively, and discovering other agents.\n"
    )

    parts.append(build_browser_directive(browser_enabled))
    parts.append(build_collaboration_prompt())
    parts.append(build_mode_prompt(mode))
    parts.append(
        _build_opencode_api_skills_prompt(
            endpoint=endpoint,
            workspace_id=workspace_id,
            token=token,
            agent_name=agent_name,
            channel_name=channel_name,
            disabled_modules=disabled_modules,
            mode=mode,
        )
    )
    return "\n".join(parts)


def build_opencode_skill_md(
    endpoint: str,
    workspace_id: str,
    token: str,
    agent_name: str,
    channel_name: str,
    disabled_modules: Optional[set] = None,
) -> str:
    body = _build_opencode_api_skills_prompt(
        endpoint=endpoint,
        workspace_id=workspace_id,
        token=token,
        agent_name=agent_name,
        channel_name=channel_name,
        disabled_modules=disabled_modules,
        mode="execute",
    )

    identity = build_workspace_identity(
        agent_name, workspace_id, channel_name, "execute"
    )
    collab = build_collaboration_prompt()

    frontmatter = (
        "---\n"
        "name: openagents-workspace\n"
        'description: "Share files, browse websites, and collaborate '
        "with other agents in an OpenAgents workspace. Use when: "
        "(1) sharing results or reports with the user or other agents, "
        "(2) browsing a website to gather information, "
        "(3) reading files shared by users or other agents, "
        '(4) checking who else is in the workspace."\n'
        "---\n\n"
    )

    return frontmatter + identity + "\n" + collab + "\n" + body
