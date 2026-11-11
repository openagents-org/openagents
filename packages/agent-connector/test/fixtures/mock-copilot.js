#!/usr/bin/env node
/**
 * Mock GitHub Copilot CLI for adapter tests — no real `copilot`, GitHub account,
 * or Copilot subscription required.
 *
 * Behaviour is anchored on REAL CLI v1.0.63 output
 * (see test/fixtures/copilot-cli-real-samples.md):
 *   - `--version` prints "GitHub Copilot CLI <v>." form.
 *   - Auth/session/network failures print to STDERR, leave STDOUT EMPTY, exit 1
 *     (there is NO JSONL error event on stdout in those cases).
 *
 * The SUCCESS-path JSONL (text/tool/file/done) is BEST-EFFORT and explicitly
 * UNVERIFIED (no subscription was available to capture it); it exists only to
 * exercise the adapter's event mapping, and does not assert the real schema.
 *
 * Env-driven:
 *   MOCK_COPILOT_SCENARIO = success | error_auth | error_token | error_org |
 *                           stale_session | timeout_silent | ask_user | crash
 *   MOCK_COPILOT_VERSION  = printed for `--version` (default 1.0.63)
 *   MOCK_COPILOT_ECHO_ARGS_FILE = if set, write argv (JSON) here for assertions
 *   MOCK_COPILOT_ECHO_STDIN_FILE = if set and there is no `-p`, read the
 *                           prompt from stdin (as the real CLI does when one is
 *                           piped) and write it here before running
 */
'use strict';

const fs = require('fs');

const argv = process.argv.slice(2);

if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write(`GitHub Copilot CLI ${process.env.MOCK_COPILOT_VERSION || '1.0.63'}.\n`);
  process.exit(0);
}

if (process.env.MOCK_COPILOT_ECHO_ARGS_FILE) {
  try { fs.writeFileSync(process.env.MOCK_COPILOT_ECHO_ARGS_FILE, JSON.stringify(argv)); } catch {}
}

const scenario = process.env.MOCK_COPILOT_SCENARIO || 'success';
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
// Real CLI uses `--resume=<value>` (optional-value flag), so detect both forms.
const resuming = argv.some((a) => a === '--resume' || a.startsWith('--resume='));

function failStderr(text, code = 1) {
  process.stderr.write(text.endsWith('\n') ? text : text + '\n');
  process.exit(code);
}

function run() {
  switch (scenario) {
    case 'success':
      // BEST-EFFORT / UNVERIFIED success-path JSONL (see header).
      emit({ type: 'session', session_id: 'mock-sess-123' });
      emit({ type: 'reasoning', text: 'Looking at the project…' });
      emit({ type: 'tool_call', name: 'shell', arguments: { command: 'ls -la' } });
      emit({ type: 'tool_result', output: 'a.txt\nb.txt', exit_code: 0 });
      emit({ type: 'command_execution', command: 'npm test', exit_code: 0, output: 'ok' });
      emit({ type: 'file_change', path: 'src/x.js', action: 'write' });
      emit({ type: 'text.delta', delta: 'All ' });
      emit({ type: 'text.delta', delta: 'done.' });
      emit({ type: 'message.completed', text: 'All done. Created src/x.js.' });
      emit({ type: 'usage', model: 'mock-model', usage: { input: 5, output: 3 } });
      emit({ type: 'done', status: 'completed' });
      process.exit(0);
      break;
    case 'error_auth':
      // Verified real stderr (no credentials), empty stdout, exit 1.
      failStderr(
        'Error: No authentication information found.\n\n' +
        'Copilot can be authenticated with GitHub using an OAuth Token or a Fine-Grained Personal Access Token.\n\n' +
        'To authenticate, you can use any of the following methods:\n' +
        "  • Start 'copilot' and run the '/login' command\n" +
        '  • Set the COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN environment variable\n' +
        "  • Run 'gh auth login' to authenticate with the GitHub CLI\n");
      break;
    case 'error_token':
      // Verified real stderr (token present but rejected), empty stdout, exit 1.
      // NOTE: the real CLI appends the SAME "To authenticate … gh auth login"
      // help block as the no-credentials error — included here so the classifier
      // ordering (token-invalid must win over no-credentials) is actually tested.
      failStderr(
        'Error: Authentication token found but could not be validated.\n\n' +
        '  Failed to fetch PAT user login (401): GitHub returned: Bad credentials\n\n' +
        'Your token may still be valid. Check your network connection and try again.\n\n' +
        'To authenticate, you can use any of the following methods:\n' +
        "  • Start 'copilot' and run the '/login' command\n" +
        '  • Set the COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN environment variable\n' +
        "  • Run 'gh auth login' to authenticate with the GitHub CLI\n");
      break;
    case 'error_org':
      failStderr('Error: Copilot CLI is disabled by your organization policy.\n');
      break;
    case 'stale_session':
      if (resuming) {
        // Verified real stderr for a resume miss, empty stdout, exit 1.
        failStderr("Error: No session, task, or name matched 'mock-sess'.\n");
      } else {
        emit({ type: 'session', session_id: 'mock-sess-fresh' });
        emit({ type: 'message.completed', text: 'Fresh session answer.' });
        emit({ type: 'done' });
        process.exit(0);
      }
      break;
    case 'ask_user':
      emit({ type: 'ask_user', question: 'Which file should I edit?' });
      process.exit(0);
      break;
    case 'timeout_silent':
      setInterval(() => {}, 1000); // hang until killed
      break;
    case 'crash':
      failStderr('Segmentation fault', 139);
      break;
    default:
      process.exit(0);
  }
}

if (process.env.MOCK_COPILOT_ECHO_STDIN_FILE && !argv.includes('-p')) {
  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('end', () => {
    try { fs.writeFileSync(process.env.MOCK_COPILOT_ECHO_STDIN_FILE, input); } catch {}
    run();
  });
} else {
  run();
}
