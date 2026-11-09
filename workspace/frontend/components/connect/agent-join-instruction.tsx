'use client';

import { Check, Copy } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useT } from '@/lib/i18n';

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
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const text = t('connect.agentJoinPrompt', { command: agentJoinCommand(code) });
  return (
    <div className="overflow-hidden rounded-xl bg-[#101828] text-slate-100">
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-3.5 pt-3 text-[13px] leading-6">{text}</pre>
      <div className="flex justify-end px-2.5 pb-2.5 pt-1">
        <button type="button" disabled={disabled} onClick={() => copyToClipboard(text)}
          className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-40">
          {isCopied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          <span>{t(isCopied ? 'onboarding.codeCopied' : 'connect.agentJoinCopy')}</span>
        </button>
      </div>
    </div>
  );
}
