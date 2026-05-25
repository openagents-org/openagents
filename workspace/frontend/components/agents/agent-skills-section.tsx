'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Globe,
  Cloud,
  CheckSquare,
  Timer,
  Repeat,
  MessageSquare,
  Lock,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { toast } from 'sonner';
import type { WorkspaceAgent, SkillCatalogEntry } from '@/lib/types';

const ICON_MAP: Record<string, React.ElementType> = {
  'message-square': MessageSquare,
  'file-text': FileText,
  globe: Globe,
  cloud: Cloud,
  'check-square': CheckSquare,
  timer: Timer,
  repeat: Repeat,
};

const CATEGORY_ORDER = ['core', 'collaboration', 'productivity', 'integration'];

function groupByCategory(catalog: SkillCatalogEntry[]) {
  const groups: Record<string, SkillCatalogEntry[]> = {};
  for (const entry of catalog) {
    const cat = entry.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(entry);
  }
  return CATEGORY_ORDER
    .filter((c) => groups[c]?.length)
    .map((c) => ({ category: c, skills: groups[c] }));
}

interface AgentSkillsSectionProps {
  agent: WorkspaceAgent;
}

export function AgentSkillsSection({ agent }: AgentSkillsSectionProps) {
  const { refreshWorkspace } = useWorkspace();
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [skills, setSkills] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    workspaceApi.getSkillCatalog().then(setCatalog).catch(() => {});
  }, []);

  useEffect(() => {
    if (!catalog.length) return;
    const current: Record<string, boolean> = {};
    for (const entry of catalog) {
      if (!entry.toggleable) continue;
      current[entry.id] =
        agent.enabledSkills?.[entry.id] !== undefined
          ? agent.enabledSkills[entry.id]
          : entry.default_enabled;
    }
    setSkills(current);
  }, [agent.agentName, agent.enabledSkills, catalog]);

  const handleToggle = useCallback(
    async (skillId: string, enabled: boolean) => {
      const prev = { ...skills };
      const updated = { ...skills, [skillId]: enabled };
      setSkills(updated);
      setSaving(skillId);

      try {
        await workspaceApi.updateMember(agent.agentName, {
          enabled_skills: updated,
        });
        await refreshWorkspace();
        const entry = catalog.find((s) => s.id === skillId);
        toast.success(`${entry?.name || skillId} ${enabled ? 'enabled' : 'disabled'}`);
      } catch {
        setSkills(prev);
        toast.error('Failed to update skill');
      } finally {
        setSaving(null);
      }
    },
    [agent.agentName, skills, catalog, refreshWorkspace]
  );

  if (!catalog.length) return null;

  const groups = groupByCategory(catalog);

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-3.5 py-2.5 border-b">
        <span className="text-xs font-medium">Skills</span>
      </div>
      <div className="divide-y">
        {groups.map(({ category, skills: entries }) => (
          <div key={category}>
            <div className="px-3.5 py-1.5 bg-muted/30">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {category}
              </span>
            </div>
            <div className="divide-y">
              {entries.map((entry) => {
                const Icon = ICON_MAP[entry.icon] || MessageSquare;
                const isEnabled = entry.toggleable
                  ? skills[entry.id] ?? entry.default_enabled
                  : true;

                return (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 px-3.5 py-2.5"
                  >
                    <div className="flex items-center justify-center size-7 rounded-md bg-muted/50 shrink-0">
                      <Icon className="size-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium leading-tight">
                        {entry.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                        {entry.description}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {entry.toggleable ? (
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={(checked) =>
                            handleToggle(entry.id, checked)
                          }
                          disabled={saving === entry.id}
                          className="scale-[0.85]"
                        />
                      ) : (
                        <Lock className="size-3.5 text-muted-foreground/50" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
