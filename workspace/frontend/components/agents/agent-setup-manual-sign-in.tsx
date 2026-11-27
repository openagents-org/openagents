'use client';

import { KeyRound, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton } from '@/components/ui/code-block';
import { useT, type MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * The agent's own login, for a device where `agn` is missing from PATH.
 * Codex keeps `--device-auth`: its default login waits for a browser on the
 * device's 127.0.0.1, which a browser on another computer never reaches.
 */
export const NATIVE_LOGIN_COMMANDS: Record<string, string> = {
  claude: 'claude auth login',
  codex: 'codex login --device-auth',
  cursor: 'cursor-agent login',
  opencode: 'opencode auth login',
  hermes: 'hermes setup',
};

/** Advice for the agents whose sign-in has a catch of its own. */
const TIPS: Record<string, MessageKey> = {
  claude: 'agentSetup.manualTip.claude',
  codex: 'agentSetup.manualTip.codex',
  cursor: 'agentSetup.manualTip.cursor',
  opencode: 'agentSetup.manualTip.opencode',
  hermes: 'agentSetup.manualTip.hermes',
  codebuddy: 'agentSetup.manualTip.codebuddy',
};

/** The sign-in step, for a CLI whose login is not a link it prints. */
const SIGN_IN_STEP: Record<string, MessageKey> = {
  // No login subcommand: the command opens the CLI, where `/login` signs in.
  codebuddy: 'agentSetup.manualStepCodebuddy',
};

function Command({ value }: { value: string }) {
  const t = useT();
  return <CodeBlock>
    <CodeBlockActions><CodeBlockCopyButton type="button" value={value} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} /></CodeBlockActions>
    <CodeBlockContent className="pe-12">{value}</CodeBlockContent>
  </CodeBlock>;
}

/**
 * Step-by-step sign-in in a terminal on the device: the way in when the
 * browser link can't be used (it failed, the device can't relay it, or the
 * user prefers a terminal), and the only way for agents without one.
 */
export function ManualSignInGuide({ type, agent, device, command, installLater = false, checking, onCheck, onUseKey }: {
  type: string; agent: string; device: string;
  /** The device's own command (`agn login codex`), else the agent's. */
  command: string;
  installLater?: boolean; checking: boolean; onCheck: () => void; onUseKey?: () => void;
}) {
  const t = useT();
  const native = NATIVE_LOGIN_COMMANDS[type];
  const fallback = native && native !== command ? native : '';
  return <div data-testid="manual-sign-in" className="flex flex-col gap-4">
    <ol className="flex list-decimal flex-col gap-4 ps-5 text-sm leading-relaxed marker:text-muted-foreground">
      <li>{t(installLater ? 'agentSetup.manualStepInstall' : 'agentSetup.manualStepTerminal', { agent, device })}</li>
      {/* A flex <li> loses its number: the layout lives on an inner div. */}
      <li><div className="flex flex-col gap-2">
        <span>{t('agentSetup.manualStepRun')}</span>
        <Command value={command} />
        {fallback && <>
          <span className="text-xs text-muted-foreground">{t('agentSetup.manualStepFallback', { agent })}</span>
          <Command value={fallback} />
        </>}
      </div></li>
      <li>{t(SIGN_IN_STEP[type] ?? 'agentSetup.manualStepBrowser', { agent })}</li>
      <li><div className="flex flex-col items-start gap-2">
        <span>{t('agentSetup.manualStepCheck')}</span>
        <Button type="button" variant="outline" className="w-fit" onClick={onCheck} disabled={checking}><RefreshCw data-icon="inline-start" className={cn(checking && 'animate-spin')} />{t('agentSetup.checkAgain')}</Button>
      </div></li>
    </ol>
    {TIPS[type] && <p className="text-xs leading-relaxed text-muted-foreground">{t(TIPS[type])}</p>}
    {onUseKey && <Button type="button" variant="link" size="xs" className="h-auto w-fit px-0" onClick={onUseKey}><KeyRound data-icon="inline-start" />{t('agentSetup.manualUseKey')}</Button>}
  </div>;
}
