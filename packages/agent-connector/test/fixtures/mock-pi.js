#!/usr/bin/env node
'use strict';

/**
 * A fake `pi` CLI for the PiAdapter tests.
 *
 * Speaks the real Pi RPC protocol (strict JSONL over stdin/stdout, LF only)
 * as captured from @earendil-works/pi-coding-agent v0.83.0, so the adapter's
 * spawn → frame → classify → post path can be exercised with no real CLI, no
 * provider, no API key and no network.
 *
 * Driven entirely by environment variables so a single script covers every
 * scenario:
 *   FAKE_SCENARIO    which event script to play (see below)
 *   FAKE_PI_VERSION  what `--version` prints (default 0.83.0)
 *   FAKE_ARGV_LOG    file to write { argv, cwd, env, stdinCommands } to
 *   FAKE_EXIT_CODE   exit code for the `exit_immediately` scenario
 *
 * Scenarios:
 *   complete       a two-turn tool loop ending in a final answer
 *   unicode        a single assistant message of multi-byte text
 *   auth_error     the prompt is ACCEPTED, then the assistant message carries
 *                  stopReason "error" + a 401 errorMessage (real Pi behavior)
 *   hang           accepts the prompt, never settles; `abort` settles it
 *   ignore_abort   accepts the prompt and `abort`, but NEVER settles
 *   crash_mid_turn accepts the prompt, emits agent_start, then dies non-zero
 *   exit_immediately  dies before reading any command
 *   ui_prompt      an extension asks a blocking question, then settles only
 *                  after the client answers it
 */

const fs = require('fs');

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write((process.env.FAKE_PI_VERSION || '0.83.0') + '\n');
  process.exit(0);
}

const scenario = process.env.FAKE_SCENARIO || 'complete';
const stdinCommands = [];

if (process.env.FAKE_ARGV_LOG) {
  const snapshot = () => {
    try {
      fs.writeFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify({
        argv: args,
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
          DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || null,
          PI_API_KEY: process.env.PI_API_KEY || null,
          PI_BASE_URL: process.env.PI_BASE_URL || null,
          PI_PROVIDER: process.env.PI_PROVIDER || null,
          PI_MODEL: process.env.PI_MODEL || null,
          PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK || null,
        },
        stdinCommands,
      }));
    } catch {}
  };
  snapshot();
  process.on('exit', snapshot);
}

if (scenario === 'exit_immediately') {
  process.exit(parseInt(process.env.FAKE_EXIT_CODE || '3', 10));
}

const w = (o) => { try { process.stdout.write(JSON.stringify(o) + '\n'); } catch {} };
const ok = (cmd) => w({ id: cmd.id, type: 'response', command: cmd.type, success: true });

const userMsg = (text) => ({ role: 'user', content: [{ type: 'text', text }], timestamp: 1 });
const asstMsg = (content, extra) => Object.assign({
  role: 'assistant',
  content,
  api: 'anthropic-messages',
  provider: 'anthropic',
  model: 'fake-model',
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
  stopReason: 'stop',
  timestamp: 2,
}, extra || {});

let promptCount = 0;
let settled = false;

function settle() {
  if (settled) return;
  settled = true;
  w({ type: 'agent_end', messages: [], willRetry: false });
  w({ type: 'agent_settled' });
}

function runComplete(prompt) {
  promptCount++;
  w({ type: 'agent_start' });
  w({ type: 'turn_start' });
  w({ type: 'message_start', message: userMsg(prompt) });
  w({ type: 'message_end', message: userMsg(prompt) });

  // Turn 1: narration, then a tool call.
  const narration = 'Let me look at the file.';
  w({ type: 'message_start', message: asstMsg([]) });
  w({
    type: 'message_update',
    message: asstMsg([{ type: 'text', text: narration }]),
    assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
  });
  w({
    type: 'message_update',
    message: asstMsg([{ type: 'text', text: narration }]),
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Let me look ' },
  });
  w({
    type: 'message_update',
    message: asstMsg([{ type: 'text', text: narration }]),
    assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: narration },
  });
  w({
    type: 'message_end',
    message: asstMsg(
      [{ type: 'text', text: narration },
        { type: 'toolCall', id: 'call_1', name: 'read', arguments: { file_path: 'src/x.js' } }],
      { stopReason: 'toolUse' },
    ),
  });
  w({ type: 'tool_execution_start', toolCallId: 'call_1', toolName: 'read', args: { file_path: 'src/x.js' } });
  w({
    type: 'tool_execution_end',
    toolCallId: 'call_1',
    toolName: 'read',
    result: { content: [{ type: 'text', text: 'file contents' }], details: {} },
    isError: false,
  });
  w({ type: 'turn_end', message: asstMsg([]), toolResults: [] });

  // Turn 2: the final answer. It echoes the prompt and the prompt counter so
  // the test can prove the SAME process handled a follow-up with context.
  const answer = `Done (prompt #${promptCount}): ${prompt}`;
  w({ type: 'turn_start' });
  w({ type: 'message_start', message: asstMsg([]) });
  w({
    type: 'message_update',
    message: asstMsg([{ type: 'text', text: answer }]),
    assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: answer },
  });
  w({ type: 'message_end', message: asstMsg([{ type: 'text', text: answer }]) });
  w({ type: 'turn_end', message: asstMsg([]), toolResults: [] });
  settled = false;
  settle();
}

function runUnicode(prompt) {
  const answer = `完成了：${prompt} 🚀`;
  w({ type: 'agent_start' });
  w({ type: 'message_start', message: asstMsg([]) });
  w({
    type: 'message_update',
    message: asstMsg([{ type: 'text', text: answer }]),
    assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: answer },
  });
  w({ type: 'message_end', message: asstMsg([{ type: 'text', text: answer }]) });
  settled = false;
  settle();
}

function runAuthError() {
  const errorMessage =
    '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
  w({ type: 'agent_start' });
  w({ type: 'message_start', message: asstMsg([]) });
  w({ type: 'message_end', message: asstMsg([], { stopReason: 'error', errorMessage }) });
  settled = false;
  settle();
}

function handle(cmd) {
  stdinCommands.push({ type: cmd.type, id: cmd.id || null, hasImages: Array.isArray(cmd.images) });

  if (cmd.type === 'extension_ui_response') {
    if (scenario === 'ui_prompt') { settled = false; settle(); }
    return;
  }

  if (cmd.type === 'abort') {
    ok(cmd);
    if (scenario === 'ignore_abort') return; // deliberately never settles
    settle();
    return;
  }

  if (cmd.type !== 'prompt') { ok(cmd); return; }

  ok(cmd); // Pi answers `prompt` as soon as it is ACCEPTED
  const prompt = String(cmd.message == null ? '' : cmd.message);

  switch (scenario) {
    case 'unicode':
      runUnicode(prompt);
      break;
    case 'auth_error':
      runAuthError();
      break;
    case 'hang':
    case 'ignore_abort':
      w({ type: 'agent_start' });
      break;
    case 'crash_mid_turn':
      w({ type: 'agent_start' });
      setTimeout(() => process.exit(parseInt(process.env.FAKE_EXIT_CODE || '7', 10)), 20);
      break;
    case 'ui_prompt':
      w({ type: 'agent_start' });
      w({
        type: 'extension_ui_request',
        id: 'ui-1',
        method: 'confirm',
        title: 'Allow dangerous command?',
        message: 'rm -rf /',
      });
      break;
    default:
      runComplete(prompt);
      break;
  }
}

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString('utf-8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try { handle(JSON.parse(line)); } catch { /* mirror Pi: ignore junk */ }
  }
});
process.stdin.on('end', () => {
  if (scenario !== 'hang' && scenario !== 'ignore_abort') process.exit(0);
});
