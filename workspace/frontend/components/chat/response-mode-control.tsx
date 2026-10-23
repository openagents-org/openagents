'use client';

import { useState } from 'react';
import { AtSign, Check, ChevronDown, Loader2, Sparkles, Waypoints } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
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
        <Button variant="ghost" size="sm" disabled={saving} className="h-7 gap-1.5 text-xs" title={t('responseMode.label')} aria-label={`${t('responseMode.label')}: ${label}`}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
          <span className="max-w-32 truncate">{label}</span><ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t('responseMode.label')}</DropdownMenuLabel>
        {(['proactive', 'passive'] as const).map(option => (
          <DropdownMenuItem key={option} disabled={saving} onSelect={() => void change({ responseMode: option, mode: 'dynamic', workflowId: '' })} className="items-start gap-2 py-2">
            {option === 'proactive' ? <Sparkles className="mt-0.5 size-4" /> : <AtSign className="mt-0.5 size-4" />}
            <div className="flex-1">
              <div className="flex items-center gap-2">{t(`responseMode.${option}`)}{!workflow && mode === option && <Check className="size-3.5" />}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">{t(`responseMode.${option}Hint`)}</p>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5"><Waypoints className="size-3.5" />{t('orchestration.pickWorkflow')}</DropdownMenuLabel>
        {workflows.length === 0 ? <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('orchestration.noWorkflows')}</p> : workflows.map(w => (
          <DropdownMenuItem key={w.id} disabled={saving} onSelect={() => void change({ mode: 'workflow', responseMode: 'proactive', workflowId: w.id })}>
            <span className="flex-1 truncate">{w.name}</span>{workflow && session.workflowId === w.id && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
