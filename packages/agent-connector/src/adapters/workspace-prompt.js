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
 * Strong directive forcing agents to use the workspace browser when the
 * workspace has Browser Fabric enabled. Emitted high in the system prompt
 * so it wins against any earlier guidance that suggests local browsing
 * tools.
 *
 * Returns '' when the toggle is off; the caller can unconditionally
 * concatenate the result.
 *
 * Mirrors `build_browser_directive` in
 * sdk/src/openagents/adapters/workspace_prompt.py.
 */
function buildBrowserDirective(browserEnabled) {
  if (!browserEnabled) return '';
  return (
    '\n## Browser Use (MANDATORY)\n' +
    'This workspace has the **shared Browser Fabric session** enabled. ' +
    'All web browsing MUST go through it so the user can watch the ' +
    'session live in their right-side panel and so cookies / state ' +
    'persist across agents.\n\n' +
    '**Use ONLY these tools for any web browsing:**\n' +
    '- `mcp__openagents-workspace__workspace_browser_open`\n' +
    '- `mcp__openagents-workspace__workspace_browser_navigate`\n' +
    '- `mcp__openagents-workspace__workspace_browser_click`\n' +
    '- `mcp__openagents-workspace__workspace_browser_type`\n' +
    '- `mcp__openagents-workspace__workspace_browser_snapshot`\n' +
    '- `mcp__openagents-workspace__workspace_browser_screenshot`\n' +
    '- `mcp__openagents-workspace__workspace_browser_list_tabs`\n' +
    '- `mcp__openagents-workspace__workspace_browser_close`\n' +
    '\n' +
    'If you don\'t have these MCP tools, use `Bash` + `curl` against ' +
    '`/v1/browser/tabs` (documented below in Shared Browser).\n\n' +
    '**FORBIDDEN — do NOT call any of these:**\n' +
    '- `mcp__browsermcp__*` (any local Browser MCP extension tool)\n' +
    '- `mcp__playwright__*`, `mcp__puppeteer__*`, `mcp__chrome-devtools__*`, or any other local-browser MCP\n' +
    '- `WebFetch`, `WebSearch`, `web_fetch`, `web_search`, or any built-in network/browser tool\n' +
    '\n' +
    'If a local browser tool errors with "extension isn\'t connected" or ' +
    '"connect your browser", do NOT ask the user to connect anything — ' +
    'the local extension is irrelevant here. Immediately switch to the ' +
    'workspace browser tools above. The Browser Fabric session is already ' +
    'running on the backend.\n'
  );
}

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
    `- Channel: ${channelName}  (this is the channel you are currently speaking in)\n` +
    `- Mode: ${mode}\n\n` +
    'When you need prior context, call `workspace_get_history` with ' +
    `\`channel="${channelName}"\` (the current channel). Without the ` +
    'channel argument the tool falls back to a default channel that may ' +
    'be different from where you are.\n'
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
function buildApiSkillsPrompt({ endpoint, workspaceId, token, agentName, channelName, disabledModules, mode = 'execute', isWindows = process.platform === 'win32' }) {
  const disabled = disabledModules || new Set();
  const baseUrl = endpoint.replace(/\/+$/, '');
  const isPlan = mode === 'plan';
  const h = `X-Workspace-Token: ${token}`;
  const curl = isWindows ? 'curl.exe' : 'curl';

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
      if (isWindows) {
        s += (
          '**To upload a file**, exec this (replace filename/content):\n' +
          `$CONTENT = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('YOUR_CONTENT'))\n` +
          `${curl} -s -X POST ${baseUrl}/v1/files/base64 ` +
          `-H "${h}" ` +
          '-H "Content-Type: application/json" ' +
          `-d "{\\"filename\\":\\"report.md\\",` +
          `\\"content_base64\\":\\"$CONTENT\\",` +
          `\\"content_type\\":\\"text/markdown\\",` +
          `\\"network\\":\\"${workspaceId}\\",` +
          `\\"source\\":\\"openagents:${agentName}\\",` +
          `\\"channel_name\\":\\"${channelName}\\"}"\n\n`
        );
      } else {
        s += (
          '**To upload a file**, exec this (replace filename/content):\n' +
          `CONTENT=$(echo -n 'YOUR_CONTENT' | base64) && ` +
          `${curl} -s -X POST ${baseUrl}/v1/files/base64 ` +
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
    }

    const tmpDir = isWindows ? '$env:TEMP' : '/tmp';
    s += (
      '**List files:**\n' +
      `\`${curl} -s -H "${h}" ${baseUrl}/v1/files?network=${workspaceId}\`\n\n` +
      '**Download file (text):**\n' +
      `\`${curl} -s -H "${h}" ${baseUrl}/v1/files/{file_id}\`\n\n` +
      '**Download file (binary/images) — save to disk, then use Read tool to view:**\n' +
      `\`${curl} -s -H "${h}" ${baseUrl}/v1/files/{file_id} -o ${tmpDir}/{filename}\`\n\n` +
      '**File info (metadata):**\n' +
      `\`${curl} -s -H "${h}" ${baseUrl}/v1/files/{file_id}/info\`\n`
    );

    if (!isPlan) {
      s += (
        '\n**Delete file:**\n' +
        `\`${curl} -s -X DELETE -H "${h}" ${baseUrl}/v1/files/{file_id}\`\n`
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
        `${curl} -s -X POST ${baseUrl}/v1/browser/tabs ` +
        `-H "${h}" -H "Content-Type: application/json" ` +
        `-d '{"url":"https://example.com","network":"${workspaceId}",` +
        `"source":"openagents:${agentName}"}'\n` +
        `Step 2 — read content: ` +
        `${curl} -s -H "${h}" ${baseUrl}/v1/browser/tabs/TAB_ID/snapshot\n` +
        `Step 3 — close tab: ` +
        `${curl} -s -X DELETE -H "${h}" ${baseUrl}/v1/browser/tabs/TAB_ID\n` +
        '(Replace TAB_ID with the id from step 1 response)\n\n'
      );
    }

    s += (
      '**List open tabs:**\n' +
      `\`${curl} -s -H "${h}" ${baseUrl}/v1/browser/tabs?network=${workspaceId}\`\n\n` +
      '**Get page content (text):**\n' +
      `\`${curl} -s -H "${h}" ${baseUrl}/v1/browser/tabs/{tab_id}/snapshot\`\n\n` +
      '**Get screenshot (PNG):**\n' +
      `\`${curl} -s -H "${h}" ${baseUrl}/v1/browser/tabs/{tab_id}/screenshot\`\n`
    );

    if (!isPlan) {
      s += (
        '\n**Open tab:**\n' +
        `\`${curl} -s -X POST -H "${h}" -H "Content-Type: application/json"` +
        ` ${baseUrl}/v1/browser/tabs` +
        ` -d '{"url":"URL","network":"${workspaceId}",` +
        `"source":"openagents:${agentName}"}'\`\n\n` +
        '**Navigate:**\n' +
        `\`${curl} -s -X POST -H "${h}" -H "Content-Type: application/json"` +
        ` ${baseUrl}/v1/browser/tabs/{tab_id}/navigate` +
        ` -d '{"url":"URL"}'\`\n\n` +
        '**Click element:**\n' +
        `\`${curl} -s -X POST -H "${h}" -H "Content-Type: application/json"` +
        ` ${baseUrl}/v1/browser/tabs/{tab_id}/click` +
        ` -d '{"selector":"CSS_SELECTOR"}'\`\n\n` +
        '**Type text:**\n' +
        `\`${curl} -s -X POST -H "${h}" -H "Content-Type: application/json"` +
        ` ${baseUrl}/v1/browser/tabs/{tab_id}/type` +
        ` -d '{"selector":"CSS_SELECTOR","text":"TEXT"}'\`\n\n` +
        '**Close tab:**\n' +
        `\`${curl} -s -X DELETE -H "${h}" ${baseUrl}/v1/browser/tabs/{tab_id}\`\n`
      );
    }

    sections.push(s);
  }

  // Message history
  sections.push(
    '\n### Message History\n\n' +
    '**Get recent messages in the current channel:**\n' +
    `\`${curl} -s -H "${h}" "${baseUrl}/v1/events?network=${workspaceId}&channel=${channelName}&type=workspace.message&sort=desc&limit=20"\`\n\n` +
    '**Get messages from a specific channel:**\n' +
    `\`${curl} -s -H "${h}" "${baseUrl}/v1/events?network=${workspaceId}&channel=CHANNEL_NAME&type=workspace.message&sort=desc&limit=20"\`\n`
  );

  // Post status update
  if (!isPlan) {
    sections.push(
      '\n### Post Status Update\n\n' +
      'Post a status/thinking message (visible in the workspace UI as an intermediate step):\n' +
      `\`${curl} -s -X POST -H "${h}" -H "Content-Type: application/json" ` +
      `${baseUrl}/v1/events -d '{"type":"workspace.message.posted",` +
      `"source":"openagents:${agentName}","target":"channel/${channelName}",` +
      `"payload":{"content":"YOUR_STATUS","message_type":"status"}}'\`\n`
    );
  }

  // To-Dos (planning)
  if (!isPlan && !disabled.has('todos')) {
    sections.push(
      '\n### To-Do List (Planning)\n\n' +
      'Create or update your to-do list to track progress. The entire list ' +
      'is replaced each time (send the full list with current statuses).\n\n' +
      '**Status values:** `pending`, `in_progress`, `completed`\n\n' +
      '**Update your to-do list:**\n' +
      `\`${curl} -s -X PUT -H "${h}" -H "Content-Type: application/json" ` +
      `${baseUrl}/v1/todos -d '{"todos":[` +
      `{"content":"First task","status":"in_progress"},` +
      `{"content":"Second task","status":"pending"}` +
      `],"network":"${workspaceId}","channel":"${channelName}",` +
      `"source":"openagents:${agentName}"}'\`\n\n` +
      '**Get your to-do list:**\n' +
      `\`${curl} -s -H "${h}" "${baseUrl}/v1/todos?network=${workspaceId}&channel=${channelName}"\`\n\n` +
      '**IMPORTANT:** When you receive a task with multiple steps or a list of things to do, ' +
      'ALWAYS create a to-do list first before starting work. This lets the user see your ' +
      'progress in real time. Update statuses as you work through each item.\n' +
      'You can assign items to other agents: `"assignee": "other-agent-name"`\n'
    );
  }

  // Timers
  if (!isPlan && !disabled.has('timers')) {
    sections.push(
      '\n### Timers\n\n' +
      'Set a timer that will send you a message after a delay, waking you up ' +
      'to continue work. Use this instead of `sleep` — timers let you release ' +
      'the session and get called back later.\n\n' +
      'Use cases: check back on a deploy, retry after a rate limit, remind ' +
      'yourself to follow up.\n\n' +
      '**Create a timer:**\n' +
      `\`${curl} -s -X POST -H "${h}" -H "Content-Type: application/json" ` +
      `${baseUrl}/v1/timers -d '{"delay":300,"message":"Check the build",` +
      `"network":"${workspaceId}","channel":"${channelName}",` +
      `"source":"openagents:${agentName}"}'\`\n\n` +
      '**List active timers:**\n' +
      `\`${curl} -s -H "${h}" "${baseUrl}/v1/timers?network=${workspaceId}&channel=${channelName}"\`\n\n` +
      '**Cancel a timer:**\n' +
      `\`${curl} -s -X DELETE -H "${h}" ${baseUrl}/v1/timers/TIMER_ID\`\n`
    );
  }

  // Routines (recurring scheduled tasks)
  if (!isPlan && !disabled.has('routines')) {
    sections.push(
      '\n### Routines (Recurring Tasks)\n\n' +
      'Create a recurring routine that fires on a schedule. Each routine gets ' +
      '**its own dedicated thread** (`routine:<id>`) so different routines never ' +
      'interfere, and the full context is preserved.\n\n' +
      '**`context` is required** — provide a thorough description of what the ' +
      'routine should do, any background info, and relevant details from the ' +
      'current conversation. This context is posted at the start of the routine\'s ' +
      'thread every time it fires, so you have full background.\n\n' +
      '**Two schedule modes:**\n' +
      '- **Daily**: `hour` (0-23 UTC) + `minute` (0-59), optional `days` ' +
      'array (0=Mon, 6=Sun). Omit `days` for every day.\n' +
      '- **Interval**: `interval_minutes` (1-1440). Fires every N minutes. ' +
      'Mutually exclusive with `hour`/`minute`.\n\n' +
      '**Create a daily routine:**\n' +
      `\`${curl} -s -X POST -H "${h}" -H "Content-Type: application/json" ` +
      `${baseUrl}/v1/routines -d '{"name":"Daily PR Review","message":"Review open PRs",` +
      `"context":"Review all open pull requests on the main repo. Check for merge conflicts, ` +
      `CI failures, and stale PRs older than 3 days. Post a summary to the workspace.",` +
      `"hour":8,"minute":0,` +
      `"network":"${workspaceId}",` +
      `"source":"openagents:${agentName}"}'\`\n\n` +
      '**List active routines:**\n' +
      `\`${curl} -s -H "${h}" "${baseUrl}/v1/routines?network=${workspaceId}"\`\n\n` +
      '**Cancel a routine:**\n' +
      `\`${curl} -s -X DELETE -H "${h}" ${baseUrl}/v1/routines/ROUTINE_ID\`\n`
    );
  }

  // Discovery
  sections.push(
    '\n### Discover Agents\n\n' +
    '**List all agents in the workspace (with status and role):**\n' +
    `\`${curl} -s -H "${h}" ${baseUrl}/v1/discover?network=${workspaceId}\`\n`
  );

  return sections.join('\n');
}

/**
 * Guardrails shared across all adapter prompt builders.
 */
function buildGuardrails() {
  return (
    '\nIMPORTANT: Never use AskUserQuestion. ' +
    'AskUserQuestion blocks the subprocess and will hang the thread. ' +
    'If you need to ask the user something, just write the question ' +
    'as your text response.\n' +
    '\nIMPORTANT: When the user gives you a numbered list, bulleted list, or ' +
    'multiple tasks in a single message, you MUST create a to-do list BEFORE ' +
    'doing any work. This is mandatory — no exceptions, even for simple tasks. ' +
    'The to-do list lets the user track your progress in real time.\n' +
    '\nIMPORTANT: Do NOT use built-in scheduling tools (CronCreate, CronDelete, ' +
    'CronList, ScheduleWakeup). For timers, routines, and recurring tasks, ' +
    'ALWAYS use the workspace REST API (curl commands in your skill instructions). ' +
    'Built-in scheduling is local-only and won\'t appear in the workspace.\n'
  );
}

/**
 * Build the system prompt for Claude adapter (MCP-based).
 * Claude gets identity + collaboration instructions but NOT API skills.
 */
function buildClaudeSystemPrompt({ agentName, workspaceId, channelName, mode = 'execute', browserEnabled = false }) {
  const parts = [];
  parts.push(buildWorkspaceIdentity(agentName, workspaceId, channelName, mode));
  parts.push(
    'Use workspace_get_history to read previous messages.\n' +
    'Use workspace_get_agents to see other agents.\n' +
    'Use workspace_put_todos to track your progress. ALWAYS create a to-do list when given multiple tasks or multi-step work.\n' +
    'Use workspace_create_timer to set a reminder that wakes you up later.\n' +
    'Use workspace_create_routine to set up recurring scheduled tasks (e.g. daily reviews).\n'
  );
  parts.push(buildBrowserDirective(browserEnabled));
  parts.push(buildCollaborationPrompt());
  parts.push(buildA2UIPrompt());

  if (mode === 'plan') {
    parts.push(
      '\nYou are in PLAN mode. Only read, analyze, and propose ' +
      'changes. Do not make edits.\n'
    );
  }

  parts.push(buildGuardrails());

  return parts.join('\n');
}

/**
 * Teach the LLM how to emit interactive UI alongside its text response.
 * The frontend (OpenAgents Go) renders any A2UI-shaped JSON spec inline
 * in the chat bubble; the agent-connector strips the fenced block before
 * posting and ferries the spec via payload.spec.
 */
function buildA2UIPrompt() {
  return (
    '\n## Rendering interactive UI\n' +
    'When you want the user to interact with structured UI (a button choice, ' +
    'a form, a chart, a table, a confirmation dialog) instead of just reading ' +
    'text, emit a fenced code block tagged `a2ui` containing a JSON spec. The ' +
    "frontend renders it inline below any markdown narration you write.\n\n" +
    "The spec is a tree of `{ type, props, children?, action? }` nodes. " +
    'Supported component types include `Stack`, `Heading`, `Text`, `Image`, ' +
    '`Icon`, `Button`, `ChoiceList`, `ConfirmDialog`, `AmountInput`, `Card`, ' +
    '`Divider`, `Spacer`, `Alert`, `LineChart`, `PieChart`, `AssetPrice`, ' +
    '`BalanceCard`, `TransactionList`, `TransactionRow`. Unknown types render ' +
    'as a placeholder chip, so feel free to compose freely.\n\n' +
    'Interactive components attach an `action` object with a `name` field you ' +
    'choose. Example:\n\n' +
    '```a2ui\n' +
    '{\n' +
    '  "type": "Stack",\n' +
    '  "props": { "direction": "vertical", "spacing": 12 },\n' +
    '  "children": [\n' +
    '    { "type": "Heading", "props": { "text": "Pick a time", "level": 2 } },\n' +
    '    { "type": "Button", "props": { "label": "Morning", "action": { "name": "pick_morning" } } },\n' +
    '    { "type": "Button", "props": { "label": "Evening", "action": { "name": "pick_evening" } } }\n' +
    '  ]\n' +
    '}\n' +
    '```\n\n' +
    '### Exact prop names (these are checked verbatim — guessing will render "No data")\n\n' +
    'Layout / content:\n' +
    '- `Stack` — props: `direction` ("vertical"|"horizontal"), `spacing`, `alignment`\n' +
    '- `Card` — props: `title`, `padding`, `cornerRadius`\n' +
    '- `Divider`, `Spacer` — props: `size`, `orientation`\n' +
    '- `Heading` — props: `text`, `level` (1–4)\n' +
    '- `Text` — props: `content` **(NOT `text`)**, `style`, `weight`, `color`\n' +
    '- `Image` — props: `url`, `name`, `contentMode`, `width`, `height`\n' +
    '- `Icon` — props: `name`, `size`, `color`\n\n' +
    'Interactive:\n' +
    '- `Button` — props: `label`, `style` ("primary"|"secondary"|"destructive"), `icon`, `disabled`, `action: {name, params?}`\n' +
    '- `ConfirmDialog` — props: `title`, `message`, `confirmLabel`, `cancelLabel`, `triggerLabel`, `action`\n' +
    '- `ChoiceList` — props: `question`, `options: [{id, label}]`, `action`\n' +
    '- `AmountInput` — props: `label`, `placeholder`, `currency`, `action`\n' +
    '- `input` (lowercase) — props: `inputType` ("text"|"choice"|"number"|"date"), `id`, `label`, `placeholder`, `options`\n\n' +
    'Feedback:\n' +
    '- `Alert` — props: `title`, `message`, `severity` ("info"|"success"|"warning"|"error"), `dismissible`, `action`\n\n' +
    'Charts (Swift Charts under the hood — needs **non-empty** data with the right key):\n' +
    '- `LineChart` — props: `title`, `color`, `points: [{x, y}]` **(NOT `data`)**\n' +
    '- `PieChart` — props: `title`, `segments: [{label, value, color?}]` **(NOT `slices`)**, `showLegend`\n' +
    '- `chart` (lowercase) — simple sparkline/bar: props: `style` ("sparkline"|"bar"), `data: [number, ...]`, `labels`, `color`\n\n' +
    'Data display:\n' +
    '- `metric` (lowercase) — props: `label`, `value`, `caption`, `captionColor`, `icon`\n' +
    '- `list` (lowercase) — props: `items: [{title, subtitle, trailing, icon}]`, `maxVisible`, `expandLabel`\n' +
    '- `table` (lowercase) — **key-value rows only, not multi-column**: props: `rows: [{label, value}]`, `maxVisible`\n\n' +
    'There is no multi-column data table in the catalog. For tabular data with ' +
    'columns you have two choices: (a) use `list` with title/subtitle/trailing ' +
    'mapped to your columns, or (b) compose a Stack of horizontal Stacks of Text ' +
    'manually. Pick whichever reads better.\n\n' +
    'If your data is empty or you can\'t fit it into the available primitives, ' +
    'fall back to plain markdown — don\'t emit a spec just to wrap text in a card.\n\n' +
    'When the user interacts with a rendered component, you will receive a ' +
    "user message shaped like `[ui_action] action=pick_morning tool_call_id=... value=...`. " +
    "Use the `action` name (which you chose) to decide what to do next; the " +
    "spec you emitted earlier is in your conversation history for context.\n\n" +
    'Use a spec when:\n' +
    '- The user needs to make a discrete choice (offer buttons rather than ' +
    'asking them to type a free-form answer).\n' +
    '- Structured data is easier to scan as a chart or table than as prose.\n' +
    '- You need explicit confirmation before a destructive action.\n' +
    "- A form would gather several fields faster than back-and-forth chat.\n\n" +
    "Don't emit a spec for ordinary prose answers — narration alone is fine.\n"
  );
}

/**
 * Build the full system prompt for OpenClaw/non-MCP agents.
 */
function buildOpenclawSystemPrompt({ agentName, workspaceId, channelName, endpoint, token, mode = 'execute', disabledModules, browserEnabled = false }) {
  const parts = [];
  parts.push(buildWorkspaceIdentity(agentName, workspaceId, channelName, mode));
  parts.push(buildBrowserDirective(browserEnabled));
  parts.push(buildCollaborationPrompt());
  parts.push(buildA2UIPrompt());
  parts.push(buildModePrompt(mode));
  parts.push(buildApiSkillsPrompt({
    endpoint, workspaceId, token, agentName, channelName, disabledModules, mode,
  }));
  parts.push(buildGuardrails());
  return parts.join('\n');
}

/**
 * Build a SKILL.md file for OpenClaw's skill auto-discovery.
 */
function buildOpenclawSkillMd({ endpoint, workspaceId, token, agentName, channelName, disabledModules, browserEnabled = false }) {
  const body = buildApiSkillsPrompt({
    endpoint, workspaceId, token, agentName, channelName, disabledModules, mode: 'execute',
  });

  const identity = buildWorkspaceIdentity(agentName, workspaceId, channelName, 'execute');
  const directive = buildBrowserDirective(browserEnabled);
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

  return frontmatter + identity + directive + '\n' + collab + '\n' + body + '\n' + buildGuardrails();
}

/**
 * Build system prompt for OpenCode adapter.
 */
function buildOpenCodeSystemPrompt({ agentName, workspaceId, channelName, endpoint, token, mode = 'execute', disabledModules, browserEnabled = false }) {
  const identity = buildWorkspaceIdentity(agentName, workspaceId, channelName, mode);
  const directive = buildBrowserDirective(browserEnabled);
  const collab = buildCollaborationPrompt();
  const modePrompt = buildModePrompt(mode);
  const api = buildApiSkillsPrompt({ endpoint, workspaceId, token, agentName, channelName, disabledModules, mode });
  return identity + directive + '\n' + collab + '\n' + modePrompt + '\n' + api + '\n' + buildGuardrails();
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

  return frontmatter + identity + api + '\n' + buildGuardrails();
}

/**
 * Build a SKILL.md file for Claude Code's skill auto-discovery.
 *
 * When tool_mode is 'skills', the Claude adapter writes this file instead
 * of spawning an MCP server. Claude Code discovers the skill via its
 * .claude/skills/ directory and uses Bash + curl to call workspace APIs.
 */
function buildClaudeSkillMd({ endpoint, workspaceId, token, agentName, channelName, disabledModules, browserEnabled = false }) {
  const api = buildApiSkillsPrompt({
    endpoint, workspaceId, token, agentName,
    channelName: channelName || 'general',
    disabledModules,
    mode: 'execute',
  });

  const identity = buildWorkspaceIdentity(agentName, workspaceId, channelName, 'execute');
  const directive = buildBrowserDirective(browserEnabled);
  const collab = buildCollaborationPrompt();

  const frontmatter =
    '---\n' +
    'name: openagents-workspace\n' +
    'description: |\n' +
    '  OpenAgents Workspace collaboration tools — shared files, browser,\n' +
    '  and multi-agent coordination. Use when: sharing files or reports,\n' +
    '  browsing websites, reading shared files, checking workspace agents,\n' +
    '  or collaborating with other agents via @mentions.\n' +
    '---\n\n';

  return frontmatter + identity + directive + '\n' + collab + '\n' + api + '\n' + buildGuardrails();
}

/**
 * Build a SKILL.md file for Cursor CLI's skill auto-discovery.
 *
 * Written to .cursor/skills/openagents-workspace.md before each CLI spawn.
 * Cursor discovers skills from the .cursor/skills/ directory automatically.
 */
function buildCursorSkillMd({ endpoint, workspaceId, token, agentName, channelName, disabledModules, browserEnabled = false }) {
  const api = buildApiSkillsPrompt({
    endpoint, workspaceId, token, agentName,
    channelName: channelName || 'general',
    disabledModules,
    mode: 'execute',
  });

  const identity = buildWorkspaceIdentity(agentName, workspaceId, channelName, 'execute');
  const directive = buildBrowserDirective(browserEnabled);
  const collab = buildCollaborationPrompt();

  const frontmatter =
    '---\n' +
    'name: openagents-workspace\n' +
    'description: |\n' +
    '  OpenAgents Workspace collaboration tools — shared files, browser,\n' +
    '  and multi-agent coordination. Use when: sharing files or reports,\n' +
    '  browsing websites, reading shared files, checking workspace agents,\n' +
    '  or collaborating with other agents via @mentions.\n' +
    '---\n\n';

  return frontmatter + identity + directive + '\n' + collab + '\n' + api + '\n' + buildGuardrails();
}

module.exports = {
  buildWorkspaceIdentity,
  buildBrowserDirective,
  buildCollaborationPrompt,
  buildModePrompt,
  buildGuardrails,
  buildApiSkillsPrompt,
  buildClaudeSystemPrompt,
  buildOpenclawSystemPrompt,
  buildOpenclawSkillMd,
  buildOpenCodeSystemPrompt,
  buildOpenCodeSkillMd,
  buildClaudeSkillMd,
  buildCursorSkillMd,
};
