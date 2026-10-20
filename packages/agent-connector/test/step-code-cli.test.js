'use strict';

/**
 * Optional regression against a real Step Code CLI: set STEP_CODE_TEST_CLI to
 * a `step` binary (0.1.4 or newer). No StepFun account and no network: the
 * model is a local OpenAI-compatible endpoint started here, and HOME is a
 * throwaway directory seeded with a user's own Step setup.
 *
 * It drives the real adapter, so what it guards is the whole contract:
 *   - a user's own Step config does not reach an agent run — their global MCP
 *     server (also one Claude Code has), saved credential and default model
 *     stay out, and the built-in StepPage and scheduling tools are off; the
 *     form's key and model are what the request carries, while the project's
 *     CLAUDE.md and the user's skills still load;
 *   - execute mode runs on Full Access, acknowledged only in the adapter's own
 *     config — the user's ~/.stepcode/config.toml is never written;
 *   - the workspace MCP server is the one server started, and its tools come
 *     out under the names the briefing uses;
 *   - nothing is written into the project or the user's rc files;
 *   - sessions resume, plan mode is entered and left again, neither the key
 *     nor a saved sign-in reaches the channel, and Stop leaves no process
 *     behind.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const StepCodeAdapter = require('../src/adapters/step-code');

const cli = process.env.STEP_CODE_TEST_CLI;
const KEY = 'sk-step-cli-test-form-key-0001';
const SAVED_KEY = 'sk-step-cli-test-saved-key-0002';
const LOGIN_ACCESS = 'sk-step-cli-test-login-access-0004';
const SESSION_ACCESS = 'step-cli-test-session-access-0005';
const SESSION_REFRESH = 'step-cli-test-session-refresh-0006';

// A stdio MCP server that answers the handshake, offers one tool and records
// that it ran.
const MCP_SERVER = `
const fs = require('fs');
const [name, log] = process.argv.slice(2);
fs.appendFileSync(log, name + '\\n');
let buf = '';
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
    if (m.method === 'initialize') reply({ protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name, version: '1' } });
    else if (m.method === 'tools/list') reply({ tools: [{ name: name + '_tool', description: 'x', inputSchema: { type: 'object', properties: {} } }] });
    else if (m.id !== undefined) reply({});
  }
});
process.stdin.on('end', () => process.exit(0));
`;

let dir;
let home;
let project;
let server;
let base;
const requests = [];

/**
 * The model: lists two models and answers a chat completion by rule — a
 * `TOOL:<name> <json>` prompt is one call to that tool, a tool result is
 * answered with `DONE <result>`, anything else with `PONG <n>`. A key with
 * "bad" in it is refused everywhere.
 */
function startModel() {
  let n = 0;
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      n++;
      let parsed = null;
      try { parsed = JSON.parse(body); } catch {}
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body: parsed });
      if (/bad/.test(req.headers.authorization || '')) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_api_key' } }));
        return;
      }
      if (req.method === 'GET' && /\/models/.test(req.url)) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'step-test-model', object: 'model' }, { id: 'step-other', object: 'model' }] }));
        return;
      }
      const messages = (parsed && parsed.messages) || [];
      const last = messages[messages.length - 1] || {};
      const userText = (() => {
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m.role !== 'user') continue;
          return typeof m.content === 'string' ? m.content : (m.content || []).map((b) => b.text || '').join('\n');
        }
        return '';
      })();
      const chunk = (delta, finish) => res.write(`data: ${JSON.stringify({ id: `c${n}`, object: 'chat.completion.chunk', created: 1, model: parsed.model, choices: [{ index: 0, delta, finish_reason: finish || null }] })}\n\n`);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      chunk({ role: 'assistant', content: '' });
      const tool = last.role === 'tool' ? null : userText.match(/TOOL:(\S+)\s+(\{.*\})/s);
      if (last.role === 'tool') {
        chunk({ content: `DONE ${String(last.content).slice(0, 300)}` });
        chunk({}, 'stop');
      } else if (tool) {
        chunk({ tool_calls: [{ index: 0, id: `call_${n}`, type: 'function', function: { name: tool[1], arguments: tool[2] } }] });
        chunk({}, 'tool_calls');
      } else {
        chunk({ content: `PONG ${n}` });
        chunk({}, 'stop');
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/v1`)));
}

function makeAdapter(extra = {}) {
  const a = new StepCodeAdapter({
    workspaceId: 'ws-step-cli',
    channelName: 'thread',
    token: 'ws-token-cli-test-0123456789',
    agentName: 'step-cli-bot',
    agentType: 'step-code',
    endpoint: base.replace(/\/v1$/, ''),
    agentEnv: {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      TERM: 'dumb',
      STEP_API_KEY: KEY,
      STEP_BASE_URL: base,
      STEP_MODEL: 'step-test-model',
      ...(extra.agentEnv || {}),
    },
    workingDir: project,
  });
  a._root = path.join(dir, 'oa-root');
  a._sessionsFile = path.join(dir, 'sessions.json');
  a._channelSessions = {};
  a._loadSessions();
  a._captured = { thinking: [], status: [], response: [], error: [] };
  a.sendThinking = async (_c, t) => { a._captured.thinking.push(t); };
  a.sendStatus = async (_c, t) => { a._captured.status.push(t); };
  a.sendResponse = async (_c, t) => { a._captured.response.push(t); };
  a.sendError = async (_c, t) => { a._captured.error.push(t); };
  a._reportStatus = () => {};
  a._announceUserStop = async () => {};
  a.cleanupTodos = async () => {};
  a._log = () => {};
  a.getBrowserEnabled = async () => false;
  a.client = {
    getSession: async () => ({ title: 'Session 1', titleManuallySet: false, resumeFrom: null }),
    updateSession: async () => ({}),
    getRecentMessages: async () => [],
    sendMessage: async () => ({}),
    getTodos: async () => ({ todos: [] }),
  };
  a._findStepBinary = () => cli;
  if (extra.mode) a._mode = extra.mode;
  return a;
}

const send = (a, content, channel = 'thread') =>
  a._handleMessage({ content, sessionId: channel, senderType: 'human', senderName: 'user' });
const chats = () => requests.filter((r) => r.method === 'POST' && /chat\/completions/.test(r.url));
const lastChat = () => chats()[chats().length - 1];
const toolNames = (r) => (r.body.tools || []).map((t) => (t.function || t).name);
const listing = (d) => fs.readdirSync(d).sort();
const snapshot = (root) => {
  const out = {};
  for (const f of ['.bashrc', '.zshrc', '.profile', '.zshenv']) {
    try { out[f] = fs.readFileSync(path.join(root, f), 'utf-8'); } catch { out[f] = null; }
  }
  return out;
};

describe('Step Code CLI (real binary)', { skip: !cli && 'set STEP_CODE_TEST_CLI to a step binary' }, () => {
  let rcBefore;
  let projectBefore;

  before(async () => {
    base = await startModel();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-step-cli-'));
    home = path.join(dir, 'home');
    project = path.join(dir, 'project');
    fs.mkdirSync(path.join(home, '.stepcode'), { recursive: true });
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'their-skill'), { recursive: true });
    fs.mkdirSync(project, { recursive: true });
    const mcpScript = path.join(dir, 'mcp.js');
    const mcpLog = path.join(dir, 'mcp.log');
    fs.writeFileSync(mcpScript, MCP_SERVER);
    fs.writeFileSync(mcpLog, '');
    const q = (s) => JSON.stringify(s);
    // The user's own Step setup: an MCP server, a default model, a saved key.
    fs.writeFileSync(path.join(home, '.stepcode', 'config.toml'), [
      '# StepCode configuration',
      'defaultModel = "their-default-model"',
      '[mcp_servers.usermcp]',
      `command = ${q(process.execPath)}`,
      `args = [${q(mcpScript)}, "usermcp", ${q(mcpLog)}]`,
    ].join('\n') + '\n');
    fs.writeFileSync(path.join(home, '.stepcode', 'auth.json'), JSON.stringify({ step: { type: 'api_key', key: SAVED_KEY } }));
    // Claude Code's: an MCP server, a skill, and the project's CLAUDE.md.
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { claudemcp: { command: process.execPath, args: [mcpScript, 'claudemcp', mcpLog] } } }));
    fs.writeFileSync(path.join(home, '.claude', 'skills', 'their-skill', 'SKILL.md'), '---\nname: their-skill\ndescription: THEIR-SKILL-MARKER\n---\nx\n');
    fs.writeFileSync(path.join(project, 'CLAUDE.md'), 'PROJECT-CLAUDE-MD-MARKER\n');
    for (const f of ['.bashrc', '.zshrc', '.profile']) fs.writeFileSync(path.join(home, f), `# ${f}\n`);
    rcBefore = snapshot(home);
    projectBefore = listing(project);
    fs.writeFileSync(path.join(dir, 'paths.json'), JSON.stringify({ mcpLog }));
  });

  after(() => {
    try { server.close(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('is a version the adapter supports', () => {
    const a = makeAdapter();
    const ver = a._checkVersion(cli);
    assert.equal(ver.supported, true, JSON.stringify(ver));
  });

  it("runs on the form's key and model, with only the workspace tools", async () => {
    const a = makeAdapter();
    await send(a, 'say hi');
    assert.deepEqual(a._captured.error, []);
    assert.match(a._captured.response[0] || '', /^PONG \d+$/);
    const r = lastChat();
    assert.equal(r.auth, `Bearer ${KEY}`);
    assert.equal(r.body.model, 'step-test-model');
    const tools = toolNames(r);
    assert.ok(tools.includes('mcp__openagents-workspace__workspace_get_history'), tools.join(','));
    for (const t of tools) {
      assert.ok(!/usermcp|claudemcp|steppage|cron_|workflow|_goal|clarify_user|_plan_mode/.test(t), `unexpected tool ${t}`);
    }
    const system = JSON.stringify(r.body.messages[0]);
    assert.ok(system.includes('PROJECT-CLAUDE-MD-MARKER'), 'project instructions are kept');
    assert.ok(system.includes('THEIR-SKILL-MARKER'), "the user's skills are kept");
    for (const req of requests) assert.ok(!req.auth.includes(SAVED_KEY));
    const { mcpLog } = JSON.parse(fs.readFileSync(path.join(dir, 'paths.json'), 'utf-8'));
    assert.equal(fs.readFileSync(mcpLog, 'utf-8'), '', 'a user MCP server was started');
  });

  it('resumes the session on the next message', async () => {
    const a = makeAdapter();
    await send(a, 'first ALPHA');
    await send(a, 'second BETA');
    const texts = lastChat().body.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
    assert.ok(texts.some((t) => t.includes('first ALPHA')));
    assert.ok(texts.some((t) => t.includes('second BETA')));
  });

  it('plans in plan mode, then edits again once back in execute mode', async () => {
    const outside = path.join(dir, 'outside.txt');
    const a = makeAdapter({ mode: 'plan' });
    await send(a, `TOOL:write_file ${JSON.stringify({ path: outside, content: 'x' })}`, 'plan-thread');
    assert.equal(fs.existsSync(outside), false, 'plan mode let a file be written');
    assert.ok(/plan mode/i.test(a._captured.response.join('\n')));
    a._mode = 'execute';
    await send(a, `TOOL:write_file ${JSON.stringify({ path: outside, content: 'x' })}`, 'plan-thread');
    assert.equal(fs.existsSync(outside), true, a._captured.response.join('\n'));
  });

  it('runs a dangerous command on Full Access, refuses it in plan mode, and never writes the user config', async () => {
    const userConfig = path.join(home, '.stepcode', 'config.toml');
    const before = fs.readFileSync(userConfig, 'utf-8');
    const doomed = path.join(dir, 'doomed');
    const rm = `TOOL:run_command ${JSON.stringify({ command: `rm -rf ${doomed}` })}`;

    fs.mkdirSync(path.join(doomed, 'inner'), { recursive: true });
    const plan = makeAdapter({ mode: 'plan' });
    await send(plan, rm, 'tier-plan');
    assert.equal(fs.existsSync(doomed), true, 'plan mode ran rm -rf');

    const a = makeAdapter();
    await send(a, rm, 'tier-exec');
    assert.equal(fs.existsSync(doomed), false, a._captured.response.join('\n'));
    assert.equal(fs.readFileSync(userConfig, 'utf-8'), before);
  });

  it('never posts the key the shell tool can see', async () => {
    const a = makeAdapter();
    await send(a, 'TOOL:run_command {"command":"echo the-key-is $STEP_API_KEY"}');
    await send(a, 'TOOL:run_command {"command":"echo saved-is; cat ~/.stepcode/auth.json"}');
    const posted = JSON.stringify(a._captured);
    assert.ok(posted.includes('the-key-is'), posted);
    assert.ok(posted.includes('saved-is'), posted);
    assert.ok(!posted.includes(KEY));
    assert.ok(!posted.includes(SAVED_KEY), posted);
  });

  it('runs on a saved sign-in without a key, and never posts it', async () => {
    // A `step login` credential and its account session, in a place of their
    // own so the key tests' saved key stays where it is; the sign-in's
    // endpoint is pointed at the local model.
    const loginDir = path.join(dir, 'login');
    fs.mkdirSync(loginDir, { recursive: true });
    const authPath = path.join(loginDir, 'auth.json');
    fs.writeFileSync(authPath, JSON.stringify({
      step: { type: 'oauth', access: LOGIN_ACCESS, refresh: 'step-static-credential', expires: 9999999999999, profile: 'platform_cn' },
    }));
    fs.writeFileSync(path.join(loginDir, 'step-login.json'), JSON.stringify({
      version: 1, profile: 'platform_cn', appId: 'app', deviceId: 'device',
      accessToken: SESSION_ACCESS, refreshToken: SESSION_REFRESH, accessExpiresAt: 4102444800,
    }));
    const a = makeAdapter({ agentEnv: { STEP_API_KEY: '', STEPCODE_AUTH_PATH: authPath, STEPCODE_PLATFORM_API_URL: base.replace(/\/v1$/, '') } });
    await send(a, 'TOOL:run_command {"command":"echo auth-is; cat \\"$STEPCODE_AUTH_PATH\\""}', 'login-thread');
    await send(a, 'TOOL:run_command {"command":"echo session-is; cat \\"$(dirname \\"$STEPCODE_AUTH_PATH\\")/step-login.json\\""}', 'login-thread');
    assert.equal(lastChat().auth, `Bearer ${LOGIN_ACCESS}`, 'the run did not use the sign-in');
    const posted = JSON.stringify(a._captured);
    assert.ok(posted.includes('auth-is') && posted.includes('session-is'), posted);
    for (const secret of [LOGIN_ACCESS, SESSION_ACCESS, SESSION_REFRESH]) assert.ok(!posted.includes(secret), posted);
  });

  it('reports a rejected key as one', async () => {
    const a = makeAdapter({ agentEnv: { STEP_API_KEY: 'sk-bad-cli-test-key-0003' } });
    await send(a, 'hi', 'bad-thread');
    assert.ok(/rejected/.test(a._captured.error[0] || ''), JSON.stringify(a._captured));
  });

  it('Stop leaves no process behind', { skip: process.platform === 'win32' }, async () => {
    const a = makeAdapter();
    const turn = send(a, 'TOOL:run_command {"command":"sleep 301.25","timeout_ms":600000}', 'stop-thread');
    const find = (needle) => execFileSync('ps', ['-A', '-o', 'pid=,args='], { encoding: 'utf-8' })
      .split('\n').filter((l) => l.includes(needle) && !l.includes('ps -A'));
    for (let i = 0; i < 300 && !find('sleep 301.25').length; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(find('sleep 301.25').length, 'the shell command never started');
    await a._handleUserStop('stop-thread');
    await turn;
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(find('sleep 301.25'), []);
    assert.deepEqual(find('--channel-name stop-thread'), [], 'the workspace MCP server outlived the stop');
    assert.deepEqual(a._captured.error, []);
  });

  it('left nothing in the project or the shell rc files', () => {
    assert.deepEqual(listing(project), projectBefore);
    assert.deepEqual(snapshot(home), rcBefore);
  });
});
