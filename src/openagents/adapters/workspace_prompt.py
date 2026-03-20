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
) -> str:
    """Build the system prompt for Claude adapter (MCP-based).

    Claude gets identity + collaboration instructions but NOT API skills,
    because it uses MCP tools instead.
    """
    parts = []
    parts.append(build_workspace_identity(agent_name, workspace_id, channel_name, mode))
    parts.append(
        "Use workspace_get_history to read previous messages.\n"
        "Use workspace_get_agents to see other agents.\n"
    )
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
) -> str:
    """Build the full system prompt for OpenClaw/non-MCP agents.

    Includes identity, collaboration, mode instructions, and
    REST API skills for workspace resources.
    """
    parts = []
    parts.append(build_workspace_identity(agent_name, workspace_id, channel_name, mode))
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

    return frontmatter + identity + "\n" + collab + "\n" + body


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

    # ── Browser ──
    if "browser" not in _disabled:
        s = "\n### Shared Browser\n\n"

        if not is_plan:
            s += (
                "**To browse a website**, run these steps in bash:\n"
                f"Step 1 — open tab: "
                f"curl -s -X POST {base_url}/v1/browser/tabs "
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
