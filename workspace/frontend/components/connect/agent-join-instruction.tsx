'use client';

import { useT } from '@/lib/i18n';
import { TerminalCopyButton } from './terminal-copy-button';

/** What an agent already open (Claude Code, Codex, ...) runs to connect itself: `agn join`. */
export function agentJoinCommand(code: string) {
  return `npx -y @openagents-org/agent-launcher@latest join ${code}`;
}

/**
 * The instructions a person pastes into the agent they already have open. The
 * agent runs the command, which pairs this computer with the code, adds that
 * agent to the workspace and keeps it running (packages/agent-connector/src/join.js).
 */
export function AgentJoinInstruction({ code, disabled = false }: { code: string; disabled?: boolean }) {
  const t = useT();
  const text = t('connect.agentJoinPrompt', { command: agentJoinCommand(code) });
  return (
    <div className="overflow-hidden rounded-xl bg-[#101828] text-slate-100">
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-3.5 pt-3 text-sm leading-6">{text}</pre>
      <div className="flex justify-end px-2.5 pb-2.5 pt-1">
        <TerminalCopyButton text={text} label="connect.agentJoinCopy" disabled={disabled} />
      </div>
    </div>
  );
}
