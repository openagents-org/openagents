'use client';

import { useState } from 'react';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { ImportSessionsDialog, isImportableType } from './import-sessions-dialog';
import { ProfileSection } from './agent-profile-section';
import type { NodeAgentSettings } from './use-node-agent-settings';

const TOOL: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', hermes: 'Hermes' };

/** "Import past sessions" for an agent on the viewer's own device: their
 *  sessions in the same tool come in as threads this agent continues. */
export function ImportSessionsCard({ agentName, settings }: { agentName: string; settings: NodeAgentSettings }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { node, nodeAgent } = settings;
  if (!node || !nodeAgent || !isImportableType(nodeAgent.type)) return null;
  return (
    <ProfileSection title={t('importSessions.action')}>
      <p className="text-sm text-muted-foreground">{t('importSessions.actionHint', { tool: TOOL[nodeAgent.type] })}</p>
      <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)} data-testid="import-sessions-open">
        <History data-icon="inline-start" />{t('importSessions.action')}
      </Button>
      {open && <ImportSessionsDialog open={open} onOpenChange={setOpen} node={node} type={nodeAgent.type} agentName={agentName} />}
    </ProfileSection>
  );
}
