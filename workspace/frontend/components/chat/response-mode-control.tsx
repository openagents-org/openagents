'use client';

import { useState } from 'react';
import { AtSign, ChevronDown, Sparkles, Waypoints } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';
import { useThreadAccess } from '@/hooks/use-thread-access';
import type { WorkspaceSession } from '@/lib/types';

type Updates = { responseMode?: 'proactive' | 'passive'; mode?: string; workflowId?: string | null };

export function ResponseModeControl({ session, onChange }: { session: WorkspaceSession; onChange: (updates: Updates) => Promise<void> }) {
  const t = useT();
  const { workflows } = useWorkspace();
  const access = useThreadAccess(session.sessionId);
  const [saving, setSaving] = useState(false);
  const workflow = session.orchestrationMode === 'workflow';
  const mode = session.responseMode || 'proactive';
  const Icon = workflow ? Waypoints : mode === 'passive' ? AtSign : Sparkles;
  const label = workflow ? workflows.find(w => w.id === session.workflowId)?.name || t('orchestration.workflow') : t(`responseMode.${mode}`);
  const change = async (updates: Updates) => {
    if (saving || !access?.can_manage) return;
    setSaving(true);
    try { await onChange(updates); }
    catch { toast.error(t('responseMode.saveFailed')); }
    finally { setSaving(false); }
  };
  if (!access?.can_manage) return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" />{label}</span>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={saving} title={t('responseMode.label')} aria-label={`${t('responseMode.label')}: ${label}`}>
          {saving ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" />}
          <span className="max-w-32 truncate">{label}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('responseMode.label')}</DropdownMenuLabel>
          {/* No checked option while a workflow drives the thread. Each item
              saves on select, so re-picking the current mode still applies it. */}
          <DropdownMenuRadioGroup value={workflow ? '' : mode}>
            {(['proactive', 'passive'] as const).map(option => {
              const OptionIcon = option === 'proactive' ? Sparkles : AtSign;
              return (
                <DropdownMenuRadioItem key={option} value={option} disabled={saving} onSelect={() => void change({ responseMode: option, mode: 'dynamic', workflowId: '' })} className="items-start gap-2 py-2">
                  <OptionIcon className="mt-0.5" />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span>{t(`responseMode.${option}`)}</span>
                    <span className="text-xs text-muted-foreground">{t(`responseMode.${option}Hint`)}</span>
                  </div>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
