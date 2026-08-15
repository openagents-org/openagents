#!/usr/bin/env node
'use strict';

/**
 * A fake `dsh` CLI for the DeepSeekAdapter tests.
 *
 * Speaks the real headless contract as captured from @deepseek-ai/dsh
 * 0.1.0-rc.6: `-V` prints a bare version, `--dump-config` composes and exits 0,
 * and a headless run prints the final assistant text on stdout and exits 0 —
 * or writes a diagnostic to stderr and exits non-zero. Nothing is streamed.
 *
 * Driven entirely by environment variables so one script covers every scenario:
 *   FAKE_SCENARIO      which behaviour to play (see below)
 *   FAKE_DSH_VERSION   what `-V` prints (default 0.1.0-rc.6)
 *   FAKE_ARGV_LOG      file to write { argv, cwd, env, taskFile, taskBody }
 *   FAKE_STDOUT        text printed by the `answer` scenario (empty is honoured)
 *   FAKE_BOOTSTRAP_FAIL  make `--dump-config` fail instead of the run
 *   FAKE_STDERR        text written by the `fail` scenario
 *   FAKE_EXIT_CODE     exit code for the `fail` scenario (default 1)
 *
 * Scenarios:
 *   answer         print FAKE_STDOUT (default "ok") and exit 0
 *   echo_task      print the task FILE's contents — proves the adapter put the
 *                  prompt in the file rather than in argv
 *   fail           write FAKE_STDERR to stderr and exit FAKE_EXIT_CODE
 *   partial_fail   print text on stdout AND fail — the adapter must discard it
 *   hang           never exit (drives the total-run-timeout path)
 *   slow_flush     write the answer, then exit while the pipe is still draining
 *   dump_only      exit 0 without output (used for --dump-config)
 */

const fs = require('fs');

const argv = process.argv.slice(2);

if (argv.includes('-V') || argv.includes('--version')) {
  process.stdout.write((process.env.FAKE_DSH_VERSION || '0.1.0-rc.6') + '\n');
  process.exit(0);
}

// The task is the last positional argument; the adapter passes a constant
// sentence naming a file, never the prompt itself.
const task = argv[argv.length - 1] || '';
const m = /task file at (.+?) and complete/.exec(task);
const taskFile = m ? m[1] : null;

let taskBody = null;
if (taskFile) {
  try { taskBody = fs.readFileSync(taskFile, 'utf-8'); } catch { taskBody = null; }
}

if (process.env.FAKE_ARGV_LOG) {
  try {
    fs.writeFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify({
      argv,
      cwd: process.cwd(),
      env: process.env,
      taskFile,
      taskBody,
    }));
  } catch { /* the test will notice the missing log */ }
}

if (argv.includes('--dump-config')) {
  // Bootstrap failure is opted into separately: FAKE_SCENARIO describes the
  // RUN, and a test that wants a failing run still needs bootstrap to succeed.
  if (process.env.FAKE_BOOTSTRAP_FAIL) {
    process.stderr.write(process.env.FAKE_STDERR || 'compose failed\n');
    process.exit(Number(process.env.FAKE_EXIT_CODE || 1));
  }
  process.stdout.write('- id: approval\n');
  process.exit(0);
}

const scenario = process.env.FAKE_SCENARIO || 'answer';

switch (scenario) {
  case 'echo_task':
    process.stdout.write(taskBody == null ? '<no task file>' : taskBody);
    process.exit(0);
    break;

  case 'fail':
    process.stderr.write(process.env.FAKE_STDERR || 'boom');
    process.exit(Number(process.env.FAKE_EXIT_CODE || 1));
    break;

  case 'partial_fail':
    process.stdout.write('half an answer that must never be posted');
    process.stderr.write(process.env.FAKE_STDERR || 'Error: 401 Unauthorized');
    process.exit(Number(process.env.FAKE_EXIT_CODE || 1));
    break;

  case 'hang':
    // Produce NOTHING and stay alive. A conventional idle timeout would kill
    // this; the adapter's total-run timeout is what must handle it.
    setInterval(() => {}, 1 << 30);
    break;

  case 'slow_flush': {
    // A large payload written immediately before exit: 'exit' can fire while
    // the reader still has bytes queued, which is why the adapter waits for
    // 'close'.
    const big = (process.env.FAKE_STDOUT || 'x').repeat(20000);
    process.stdout.write(big + '\nEND-OF-ANSWER');
    process.exit(0);
    break;
  }

  case 'dump_only':
    process.exit(0);
    break;

  default:
    // An EMPTY FAKE_STDOUT is a scenario (a run that says nothing), not an
    // absent one — `|| 'ok'` would erase the difference.
    process.stdout.write(
      'FAKE_STDOUT' in process.env ? process.env.FAKE_STDOUT : 'ok',
    );
    process.exit(0);
}
