import { NextResponse } from 'next/server';
import { runRoundtableCliAgent } from '@/lib/roundtable-cli-runner';
import type { RoundtableAgentRuntime } from '@/lib/roundtable-engine';

export const runtime = 'nodejs';

interface RuntimeRequestBody {
  runtime?: RoundtableAgentRuntime;
  prompt?: string;
  agentName?: string;
  phaseId?: string;
  timeoutMs?: number;
  roleAgent?: {
    mode: 'role_agent';
    skillId?: string;
    skillPath?: string;
    skillLoadStatus?: string;
    profileDir?: string;
  };
}

export async function POST(request: Request) {
  let body: RuntimeRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: '请求体不是有效 JSON。' }, { status: 400 });
  }

  if (body.runtime !== 'codex_cli' && body.runtime !== 'claude_code_cli') {
    return NextResponse.json({ ok: false, error: '仅 Codex CLI / Claude Code CLI runtime 可由该接口执行。' }, { status: 400 });
  }
  if (!body.prompt?.trim()) {
    return NextResponse.json({ ok: false, error: '缺少 prompt。' }, { status: 400 });
  }

  let result;
  try {
    result = await runRoundtableCliAgent({
      runtime: body.runtime,
      prompt: body.prompt,
      agentName: body.agentName || 'agent',
      phaseId: body.phaseId || 'roundtable',
      timeoutMs: body.timeoutMs || 180_000,
      roleAgent: body.roleAgent,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
