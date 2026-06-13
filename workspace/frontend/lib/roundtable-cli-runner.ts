import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RoundtableAgentRuntime } from './roundtable-engine';

export interface RoundtableRoleAgentRunConfig {
  mode: 'role_agent';
  skillId?: string;
  skillPath?: string;
  skillLoadStatus?: string;
  profileDir?: string;
}

export interface RoundtableCliRunInput {
  runtime: Exclude<RoundtableAgentRuntime, 'demo'>;
  prompt: string;
  agentName: string;
  phaseId: string;
  timeoutMs?: number;
  roleAgent?: RoundtableRoleAgentRunConfig;
}

export interface RoundtableCliRunResult {
  ok: boolean;
  output: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  command: string;
  durationMs: number;
  promptPath: string;
  outputPath?: string;
  error?: string;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

const projectRoot = join(process.cwd(), '..', '..');
const runtimeCwd = process.env.ROUNDTABLE_RUNTIME_CWD || projectRoot;
const artifactDir = process.env.ROUNDTABLE_RUNTIME_ARTIFACT_DIR ||
  join(projectRoot, 'output', 'roundtable-runtime');

function safeSlug(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'agent';
}

function ensureArtifactDir() {
  mkdirSync(artifactDir, { recursive: true });
}

function writeArtifact(name: string, value: string): string {
  ensureArtifactDir();
  const path = join(artifactDir, name);
  writeFileSync(path, value, 'utf8');
  return path;
}

function quoteCmdArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function commandForDisplay(command: string, args: string[]): string {
  return [command, ...args].map((item) => item.includes(' ') ? quoteCmdArg(item) : item).join(' ');
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ProcessResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const isWindowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
    let child;
    try {
      child = isWindowsScript
        ? spawn('cmd.exe', ['/d', '/c', ['call', quoteCmdArg(command), ...args.map(quoteCmdArg)].join(' ')], {
          cwd: options.cwd,
          env: options.env,
          windowsVerbatimArguments: true,
          windowsHide: true,
        })
        : spawn(command, args, {
          cwd: options.cwd,
          env: options.env,
          windowsHide: true,
        });
    } catch (error) {
      resolve({
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
        durationMs: Date.now() - started,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      resolve({
        stdout,
        stderr: `${stderr}\nProcess timed out after ${options.timeoutMs}ms`.trim(),
        exitCode: null,
        durationMs: Date.now() - started,
      });
    }, options.timeoutMs || 180_000);

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        exitCode: null,
        durationMs: Date.now() - started,
      });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code, durationMs: Date.now() - started });
    });

    if (options.input) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();
  });
}

async function where(command: string): Promise<string[]> {
  if (process.platform !== 'win32') return [command];
  const result = await runProcess('where.exe', [command], { timeoutMs: 5_000 });
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function resolveExecutable(
  command: string,
  envName: string,
  preferredExtensions: string[],
): Promise<string> {
  const configured = process.env[envName];
  if (configured) return configured;
  const candidates = await where(command);
  const existing = candidates.filter((item) => existsSync(item));
  const sorted = [...existing].sort((a, b) => {
    const aIndex = preferredExtensions.findIndex((ext) => a.toLowerCase().endsWith(ext));
    const bIndex = preferredExtensions.findIndex((ext) => b.toLowerCase().endsWith(ext));
    return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex);
  });
  return sorted[0] || command;
}

export function buildCodexArgs(input: {
  input: RoundtableCliRunInput;
  outputPath: string;
  runtimeCwd: string;
}): string[] {
  const isRoleAgent = input.input.roleAgent?.mode === 'role_agent';
  const base = [
    'exec',
    '--sandbox',
    'read-only',
    '--color',
    'never',
    '--cd',
    input.runtimeCwd,
    '-o',
    input.outputPath,
    '-',
  ];
  return isRoleAgent ? base : [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--sandbox',
    'read-only',
    '--ignore-rules',
    '--color',
    'never',
    '--cd',
    input.runtimeCwd,
    '-o',
    input.outputPath,
    '-',
  ];
}

export function buildClaudeArgs(input: RoundtableCliRunInput): string[] {
  const base = ['-p', input.prompt, '--output-format', 'text'];
  return input.roleAgent?.mode === 'role_agent'
    ? base
    : [...base, '--no-session-persistence', '--disable-slash-commands'];
}

async function runCodex(input: RoundtableCliRunInput): Promise<RoundtableCliRunResult> {
  const command = await resolveExecutable('codex', 'CODEX_EXE', ['.cmd', '.exe', '']);
  const slug = `${safeSlug(input.phaseId)}-${safeSlug(input.agentName)}-${Date.now().toString(36)}`;
  const promptPath = writeArtifact(`${slug}.prompt.md`, input.prompt);
  const outputPath = join(artifactDir, `${slug}.codex-output.txt`);
  const args = buildCodexArgs({ input, outputPath, runtimeCwd });
  const result = await runProcess(command, args, {
    cwd: runtimeCwd,
    input: input.prompt,
    timeoutMs: input.timeoutMs,
    env: { ...process.env, NO_COLOR: '1' },
  });
  const output = existsSync(outputPath) ? readFileSync(outputPath, 'utf8').trim() : result.stdout.trim();
  writeArtifact(`${slug}.codex-stdout.log`, result.stdout);
  writeArtifact(`${slug}.codex-stderr.log`, result.stderr);
  return {
    ok: result.exitCode === 0 && output.length > 0,
    output,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    command: commandForDisplay(command, args),
    durationMs: result.durationMs,
    promptPath,
    outputPath,
    error: result.exitCode === 0 ? undefined : result.stderr || result.stdout || 'Codex CLI returned no output.',
  };
}

async function runClaude(input: RoundtableCliRunInput): Promise<RoundtableCliRunResult> {
  const command = await resolveExecutable('claude', 'CLAUDE_EXE', ['.exe', '.cmd', '']);
  const slug = `${safeSlug(input.phaseId)}-${safeSlug(input.agentName)}-${Date.now().toString(36)}`;
  const promptPath = writeArtifact(`${slug}.prompt.md`, input.prompt);
  const args = buildClaudeArgs(input);
  const result = await runProcess(command, args, {
    cwd: runtimeCwd,
    timeoutMs: input.timeoutMs,
    env: { ...process.env, NO_COLOR: '1' },
  });
  const outputPath = writeArtifact(`${slug}.claude-output.txt`, result.stdout.trim());
  writeArtifact(`${slug}.claude-stderr.log`, result.stderr);
  return {
    ok: result.exitCode === 0 && result.stdout.trim().length > 0,
    output: result.stdout.trim(),
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    command: commandForDisplay(command, buildClaudeArgs({ ...input, prompt: '<prompt>' })),
    durationMs: result.durationMs,
    promptPath,
    outputPath,
    error: result.exitCode === 0 ? undefined : result.stderr || result.stdout || 'Claude Code CLI returned no output.',
  };
}

export async function runRoundtableCliAgent(input: RoundtableCliRunInput): Promise<RoundtableCliRunResult> {
  ensureArtifactDir();
  if (input.runtime === 'codex_cli') return runCodex(input);
  return runClaude(input);
}

export function getRoundtableRuntimeArtifactDir(): string {
  ensureArtifactDir();
  return artifactDir || tmpdir();
}
