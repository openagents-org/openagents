/**
 * Shared workspace prompt builder for all adapters.
 *
 * Generates system prompt sections that teach agents about:
 * - Their identity and workspace context
 * - Multi-agent collaboration (@mention delegation)
 * - Workspace REST API skills (files, browser, tunnels)
 *
 * Direct port of Python: sdk/src/openagents/adapters/workspace_prompt.py
 */

'use strict';

/**
 * Build the identity section common to all adapters.
 */
function buildWorkspaceIdentity(agentName, workspaceId, channelName, mode = 'execute') {
  return (
    `You are agent '${agentName}' connected to an OpenAgents workspace.\n` +
    'Your text responses are automatically posted to the workspace chat ' +
    '— just write your answer naturally.\n\n' +
    '## Workspace Context\n' +
    `- Workspace ID: ${workspaceId}\n` +
    `- Channel: ${channelName}\n` +
    `- Mode: ${mode}\n`
  );
}

/**
 * Build the multi-agent collaboration instructions.
 */
function buildCollaborationPrompt() {
  return (
    '\n## Multi-Agent Collaboration\n' +
    'To delegate work to another agent, @mention them in your response. ' +
    'Only @mentioned agents will receive the message.\n\n' +
    'IMPORTANT: Do NOT @mention an agent just to say thanks or acknowledge ' +
    '— that wakes them up for nothing. Only @mention when you need them ' +
    'to do work. When the task is complete, report results to the user ' +
    'without @mentioning other agents.\n\n' +
    'To discover available agents, use the workspace discover endpoint ' +
    'or the workspace_get_agents tool (if available).\n'
  );
}

/**
 * Build mode-specific instructions.
 */
function buildModePrompt(mode) {
  if (mode === 'plan') {
    return (
      '\n## Mode: PLAN\n' +
      'You are in PLAN mode. Only read, analyze, and propose.\n' +
      '- Do NOT write code, make changes, or execute actions.\n' +
      '- Outline your plan step by step.\n' +
      '- Describe what changes you would make and why.\n' +
      '- Ask clarifying questions if needed.\n' +
      '- When the user is satisfied, they can switch you to Execute mode.\n'
    );
  }
  return (
    '\n## Mode: EXECUTE\n' +
    'You are in EXECUTE mode. You can write code, make changes, ' +
    'and take actions.\n' +
    'Be helpful, concise, and direct. Use markdown formatting.\n'
  );
}

/**
 * Build REST API skill instructions for non-MCP agents.
 *
 * These teach the agent how to interact with workspace resources
 * (files, browser, tunnels) by calling HTTP endpoints directly.
 *
 * In plan mode, only read-only operations are documented.
 */
function buildApiSkillsPrompt({ endpoint, workspaceId, token, agentName, channelName, disabledModules, mode = 'execute' }) {
  const disabled = disabledModules || new Set();
  const baseUrl = endpoint.replace(/\/+$/, '');
  const isPlan = mode === 'plan';
  const h = `X-Workspace-Token: ${token}`;

  const sections = [];

  // Capabilities preamble
  const caps = [];
  if (!disabled.has('files')) caps.push('share and read files with other agents and users');
  if (!disabled.has('browser')) caps.push('browse websites in a shared browser');
  caps.push('discover other agents in the workspace');

  sections.push(
    '## Workspace Tools (MANDATORY)\n\n' +
    'You can ' + caps.join(', ') + '.\n' +
    'These are WORKSPACE tools shared with all agents and users. ' +
    'They are different from your native tools.\n\n' +
    '**HOW TO USE:** Call your `exec` tool to run the `curl` commands below. ' +
    'Do NOT output curl commands as text — EXECUTE them with `exec`.\n\n' +
    '**IMPORTANT — tool priority:**\n' +
    '- ALWAYS use `exec` + `curl` (documented below) for workspace operations.\n' +
    '- Do NOT use `workspace_browser_*` native tools — they are not configured ' +
    'and will fail.\n' +
    '- Do NOT use `web_fetch`, `browser`, or any native browsing tool ' +
    'when the user asks to use the workspace browser — use `exec` + `curl` instead.\n' +
    '- The workspace browser is a *shared* browser visible to all users and agents.\n\n' +
    '**Auth header** (include on every request):\n' +
    `\`X-Workspace-Token: ${token}\`\n`
  );

  // Files
  if (!disabled.has('files')) {
    let s = '\n### Shared Files\n\n';

    if (!isPlan) {
      s += (
        '**To upload a file**, exec this (replace filename/content):\n' +
        `CONTENT=$(echo -n 'YOUR_CONTENT' | base64) && ` +
        `curl -s -X POST ${baseUrl}/v1/files/base64 ` +
        `-H "${h}" ` +
        '-H "Content-Type: application/json" ' +
        `-d '{"filename":"report.md",` +
        `"content_base64":"'"$CONTENT"'",` +
        `"content_type":"text/markdown",` +
        `"network":"${workspaceId}",` +
        `"source":"openagents:${agentName}",` +
        `"channel_name":"${channelName}"}'\n\n`
      );
    }

    s += (
      '**List files:**\n' +
      `\`curl -s -H "${h}" ${baseUrl}/v1/files?network=${workspaceId}\`\n\n` +
      '**Download file:**\n' +
      `\`curl -s -H "${h}" ${baseUrl}/v1/files/{file_id}\`\n\n` +
      '**File info (metadata):**\n' +
      `\`curl -s -H "${h}" ${baseUrl}/v1/files/{file_id}/info\`\n`
    );

    if (!isPlan) {
      s += (
        '\n**Delete file:**\n' +
        `\`curl -s -X DELETE -H "${h}" ${baseUrl}/v1/files/{file_id}\`\n`
      );
    }

    sections.push(s);
  }

  // Browser
  if (!disabled.has('browser')) {
    let s = '\n### Shared Browser\n\n';

    if (!isPlan) {
      s += (
        '**To browse a website**, exec these steps (use exec for each):\n' +
        `Step 1 — open tab: ` +
        `curl -s -X POST ${baseUrl}/v1/browser/tabs ` +
        `-H "${h}" -H "Content-Type: application/json" ` +
        `-d '{"url":"https://example.com","network":"${workspaceId}",` +
        `"source":"openagents:${agentName}"}'\n` +
        `Step 2 — read content: ` +
        `curl -s -H "${h}" ${baseUrl}/v1/browser/tabs/TAB_ID/snapshot\n` +
        `Step 3 — close tab: ` +
        `curl -s -X DELETE -H "${h}" ${baseUrl}/v1/browser/tabs/TAB_ID\n` +
        '(Replace TAB_ID with the id from step 1 response)\n\n'
      );
    }

    s += (
      '**List open tabs:**\n' +
      `\`curl -s -H "${h}" ${baseUrl}/v1/browser/tabs?network=${workspaceId}\`\n\n` +
      '**Get page content (text):**\n' +
      `\`curl -s -H "${h}" ${baseUrl}/v1/browser/tabs/{tab_id}/snapshot\`\n\n` +
      '**Get screenshot (PNG):**\n' +
      `\`curl -s -H "${h}" ${baseUrl}/v1/browser/tabs/{tab_id}/screenshot\`\n`
    );

    if (!isPlan) {
      s += (
        '\n**Open tab:**\n' +
        `\`curl -s -X POST -H "${h}" -H "Content-Type: application/json"` +
        ` ${baseUrl}/v1/browser/tabs` +
        ` -d '{"url":"URL","network":"${workspaceId}",` +
        `"source":"openagents:${agentName}"}'\`\n\n` +
        '**Navigate:**\n' +
        `\`curl -s -X POST -H "${h}" -H "Content-Type: application/json"` +
        ` ${baseUrl}/v1/browser/tabs/{tab_id}/navigate` +
        ` -d '{"url":"URL"}'\`\n\n` +
        '**Click element:**\n' +
        `\`curl -s -X POST -H "${h}" -H "Content-Type: application/json"` +
        ` ${baseUrl}/v1/browser/tabs/{tab_id}/click` +
        ` -d '{"selector":"CSS_SELECTOR"}'\`\n\n` +
        '**Type text:**\n' +
        `\`curl -s -X POST -H "${h}" -H "Content-Type: application/json"` +
        ` ${baseUrl}/v1/browser/tabs/{tab_id}/type` +
        ` -d '{"selector":"CSS_SELECTOR","text":"TEXT"}'\`\n\n` +
        '**Close tab:**\n' +
        `\`curl -s -X DELETE -H "${h}" ${baseUrl}/v1/browser/tabs/{tab_id}\`\n`
      );
    }

    sections.push(s);
  }

  // Discovery
  sections.push(
    '\n### Discover Agents\n' +
    `\`curl -s -H "${h}" ${baseUrl}/v1/discover?network=${workspaceId}\`\n`
  );

  return sections.join('\n');
}

/**
 * Build the system prompt for Claude adapter (MCP-based).
 * Claude gets identity + collaboration instructions but NOT API skills.
 */
function buildClaudeSystemPrompt({ agentName, workspaceId, channelName, mode = 'execute' }) {
  const parts = [];
  parts.push(buildWorkspaceIdentity(agentName, workspaceId, channelName, mode));
  parts.push(
    'Use workspace_get_history to read previous messages.\n' +
    'Use workspace_get_agents to see other agents.\n'
  );
  parts.push(buildCollaborationPrompt());

  if (mode === 'plan') {
    parts.push(
      '\nYou are in PLAN mode. Only read, analyze, and propose ' +
      'changes. Do not make edits.\n'
    );
  }

  parts.push(
    '\nIMPORTANT: Never use AskUserQuestion. ' +
    'AskUserQuestion blocks the subprocess and will hang the thread. ' +
    'If you need to ask the user something, just write the question ' +
    'as your text response.\n'
  );

  return parts.join('\n');
}

/**
 * Build the full system prompt for OpenClaw/non-MCP agents.
 */
function buildOpenclawSystemPrompt({ agentName, workspaceId, channelName, endpoint, token, mode = 'execute', disabledModules }) {
  const parts = [];
  parts.push(buildWorkspaceIdentity(agentName, workspaceId, channelName, mode));
  parts.push(buildCollaborationPrompt());
  parts.push(buildModePrompt(mode));
  parts.push(buildApiSkillsPrompt({
    endpoint, workspaceId, token, agentName, channelName, disabledModules, mode,
  }));
  return parts.join('\n');
}

/**
 * Build a SKILL.md file for OpenClaw's skill auto-discovery.
 */
function buildOpenclawSkillMd({ endpoint, workspaceId, token, agentName, channelName, disabledModules }) {
  const body = buildApiSkillsPrompt({
    endpoint, workspaceId, token, agentName, channelName, disabledModules, mode: 'execute',
  });

  const identity = buildWorkspaceIdentity(agentName, workspaceId, channelName, 'execute');
  const collab = buildCollaborationPrompt();

  const frontmatter = (
    '---\n' +
    'name: openagents-workspace\n' +
    'description: "Share files, browse websites, and collaborate ' +
    'with other agents in an OpenAgents workspace. Use when: ' +
    '(1) sharing results or reports with the user or other agents, ' +
    '(2) browsing a website to gather information, ' +
    '(3) reading files shared by users or other agents, ' +
    '(4) checking who else is in the workspace."\n' +
    'metadata:\n' +
    '  {"openclaw": {"always": true, "emoji": "\\U0001F310"}}\n' +
    '---\n\n'
  );

  return frontmatter + identity + '\n' + collab + '\n' + body;
}

/**
 * Build system prompt for OpenCode adapter.
 */
function buildOpenCodeSystemPrompt({ agentName, workspaceId, channelName, endpoint, token, mode = 'execute', disabledModules }) {
  const identity = buildWorkspaceIdentity(agentName, workspaceId, channelName, mode);
  const collab = buildCollaborationPrompt();
  const modePrompt = buildModePrompt(mode);
  const api = buildApiSkillsPrompt({ endpoint, workspaceId, token, agentName, channelName, disabledModules, mode });
  return identity + '\n' + collab + '\n' + modePrompt + '\n' + api;
}

/**
 * Build workspace skill markdown for OpenCode (written to .opencode/skills/).
 */
function buildOpenCodeSkillMd({ endpoint, workspaceId, token, agentName, channelName, disabledModules }) {
  const api = buildApiSkillsPrompt({
    endpoint, workspaceId, token, agentName,
    channelName: channelName || 'general',
    disabledModules,
    mode: 'execute',
  });

  const frontmatter =
    '---\n' +
    'name: openagents-workspace\n' +
    'description: OpenAgents Workspace API — shared files, browser, and agent collaboration\n' +
    '---\n\n';

  const identity =
    `You are agent '${agentName}' connected to OpenAgents workspace ${workspaceId}.\n` +
    'Use these APIs via bash + curl to interact with the workspace.\n\n';

  return frontmatter + identity + api;
}

module.exports = {
  buildWorkspaceIdentity,
  buildCollaborationPrompt,
  buildModePrompt,
  buildApiSkillsPrompt,
  buildClaudeSystemPrompt,
  buildOpenclawSystemPrompt,
  buildOpenclawSkillMd,
  buildOpenCodeSystemPrompt,
  buildOpenCodeSkillMd,
};
