#!/usr/bin/env node
'use strict';

/**
 * A stand-in for `openworker-server`.
 *
 * Speaks the two surfaces the adapter actually uses — `GET /v1/health` behind
 * the `X-OpenWorker-Token` header, and `/ws/session/<id>` behind the token as a
 * WebSocket SUBPROTOCOL — so the adapter's spawn → health-poll → handshake →
 * prompt-answering → reply path runs end to end with no Python, no model and no
 * network.
 *
 * Two details here are the contract, not scaffolding, and a test would pass
 * against a laxer mock while the real server rejected us:
 *
 *   - the handshake is refused unless one of the OFFERED subprotocols equals
 *     the launch token, and it is accepted by echoing back `openworker` — a
 *     protocol the client must therefore also have offered;
 *   - a turn only ends when `turn_done` is sent, so a scenario that parks on a
 *     prompt and never gets an answer hangs exactly the way production would.
 *
 * Every inbound frame is appended to FAKE_CAPTURE, which is how the tests assert
 * what the adapter said back.
 */

const fs = require('fs');
const http = require('http');
// The tests run this file from a temp directory outside the package, where
// `require('ws')` cannot resolve; they pass the resolved path instead.
const { WebSocketServer } = require(process.env.FAKE_WS_PATH || 'ws');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};

const port = Number(flag('--port'));
const token = process.env.COWORKER_API_TOKEN || '';
const scenario = process.env.FAKE_SCENARIO || 'success';
const capturePath = process.env.FAKE_CAPTURE || '';

const capture = {
  args: argv,
  env: {
    COWORKER_STATE_DIR: process.env.COWORKER_STATE_DIR || null,
    COWORKER_EXIT_WITH_PARENT: process.env.COWORKER_EXIT_WITH_PARENT || null,
    COWORKER_PARENT_PID: process.env.COWORKER_PARENT_PID || null,
    hasApiToken: !!token,
    OPENWORKER_API_KEY: process.env.OPENWORKER_API_KEY || null,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
  },
  connections: [],
  frames: [],
  rejectedHandshakes: 0,
};

const save = () => {
  if (!capturePath) return;
  try {
    fs.writeFileSync(capturePath, JSON.stringify(capture));
  } catch {
    /* the test dir may be gone already during teardown */
  }
};

// A scenario that never binds: the adapter must classify the dead process
// rather than poll /v1/health until its timeout.
if (scenario === 'crash') {
  process.stderr.write("ModuleNotFoundError: No module named 'aisuite'\n");
  save();
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/v1/health')) {
    if (token && req.headers['x-openworker-token'] !== token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing or invalid OpenWorker sidecar token' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server,
  handleProtocols: (protocols) => {
    // `protocols` is a Set of everything the client offered. Authentication is
    // "one of them IS the token"; the ACCEPTED protocol is the constant.
    if (scenario === 'refuse' || (token && !protocols.has(token))) {
      capture.rejectedHandshakes += 1;
      save();
      return false;
    }
    return 'openworker';
  },
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  capture.connections.push({
    path: url.pathname,
    workspace: url.searchParams.get('workspace'),
    agent: url.searchParams.get('agent'),
    subprotocol: ws.protocol,
  });
  save();

  const send = (type, data = {}) => ws.send(JSON.stringify({ type, data }));
  let interrupted = false;

  send('ready', {
    session_id: url.pathname.split('/').pop(),
    model: flag('--model') || '',
    mode: flag('--mode') || 'interactive',
    workspace: url.searchParams.get('workspace'),
    running: scenario === 'busy' && capture.connections.length === 1,
  });

  const runTurn = () => {
    if (scenario === 'error') {
      send('error', { error: 'rate limited by the provider' });
      send('turn_done');
      return;
    }
    if (scenario === 'partial') {
      send('assistant_message', { text: 'Got halfway.' });
      send('error', { error: 'the provider dropped the connection' });
      send('turn_done');
      return;
    }
    if (scenario === 'empty') {
      send('turn_done');
      return;
    }
    if (scenario === 'prompts') {
      send('tool_proposed', { name: 'run_shell' });
      send('permission_required', { name: 'run_shell', arguments: { command: 'ls' } });
      return; // continues when the approval lands
    }
    if (scenario === 'directory') {
      send('directory_requested', { path: '/etc', writable: true, reason: 'read the host config' });
      return;
    }
    send('tool_started', { name: 'run_shell' });
    send('tool_finished', { name: 'run_shell', status: 'ok' });
    send('assistant_message', { text: 'Done — ran the command.' });
    send('turn_done');
  };

  ws.on('message', (raw) => {
    let frame;
    try {
      frame = JSON.parse(raw.toString('utf-8'));
    } catch {
      return;
    }
    capture.frames.push(frame);
    save();

    switch (frame.type) {
      case 'user_message':
        runTurn();
        return;
      case 'interrupt':
        interrupted = true;
        send('interrupted', {});
        send('turn_done');
        return;
      case 'approval':
        if (frame.decision === 'deny') {
          send('assistant_message', { text: 'Stopped: the command was declined.' });
          send('turn_done');
          return;
        }
        send('question_requested', { question: 'Which branch should I use?', allow_text: true });
        return;
      case 'question_response':
        send('assistant_message', { text: `Answered with: ${frame.answer}` });
        send('turn_done');
        return;
      case 'directory_response':
        send('assistant_message', { text: `Directory granted: ${frame.granted}` });
        send('turn_done');
        return;
      case 'set_model':
      case 'set_mode':
        return;
      default:
        if (!interrupted) send('input_rejected', { error: `unexpected frame ${frame.type}` });
    }
  });
});

const delay = Number(process.env.FAKE_HEALTH_DELAY_MS || 0);
setTimeout(() => {
  server.listen(port, '127.0.0.1', () => save());
}, delay);

// Exit with the daemon like the real server does, so a killed test never leaks
// a listener holding a port.
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
