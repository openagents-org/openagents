'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Settings, Copy, Check, Bot } from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { toast } from 'sonner';
import { getAgentColor, getAgentInitials } from '@/lib/helpers';
import type { Workspace, WorkspaceAgent } from '@/lib/types';

interface SettingsDialogProps {
  workspace: Workspace | null;
}

export function SettingsDialog({ workspace }: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(workspace?.name || '');
  const [saving, setSaving] = useState(false);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const { refreshWorkspace } = useWorkspace();
  const { isCopied: urlCopied, copyToClipboard: copyUrl } = useCopyToClipboard();
  const { isCopied: tokenCopied, copyToClipboard: copyToken } = useCopyToClipboard();

  // Sync descriptions from workspace agents when dialog opens
  useEffect(() => {
    if (open && workspace?.agents) {
      const descs: Record<string, string> = {};
      for (const agent of workspace.agents) {
        descs[agent.agentName] = agent.description || '';
      }
      setDescriptions(descs);
    }
  }, [open, workspace?.agents]);

  if (!workspace) return null;

  const workspaceUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/${workspace.workspaceId}${window.location.search}`
    : '';

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // Save workspace name
      await workspaceApi.updateWorkspace({ name: name.trim() });

      // Save agent descriptions
      const updates = workspace.agents.map((agent) => {
        const newDesc = descriptions[agent.agentName] ?? '';
        const oldDesc = agent.description || '';
        if (newDesc !== oldDesc) {
          return workspaceApi.updateMember(agent.agentName, { description: newDesc });
        }
        return null;
      }).filter(Boolean);

      await Promise.all(updates);
      await refreshWorkspace();
      toast.success('Settings saved');
      setOpen(false);
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) setName(workspace.name); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" mode="icon" size="sm">
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Workspace Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Workspace name */}
          <div className="space-y-2">
            <Label>Workspace Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Workspace"
            />
          </div>

          {/* Workspace URL */}
          <div className="space-y-2">
            <Label variant="secondary">Workspace URL</Label>
            <div className="flex items-center gap-2">
              <Input
                value={workspaceUrl}
                readOnly
                className="text-xs font-mono"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyUrl(workspaceUrl)}
              >
                {urlCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>

          {/* Workspace ID */}
          <div className="space-y-2">
            <Label variant="secondary">Workspace ID</Label>
            <div className="flex items-center gap-2">
              <Input
                value={workspace.workspaceId}
                readOnly
                className="text-xs font-mono"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToken(workspace.workspaceId)}
              >
                {tokenCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>

          {/* Agent Descriptions */}
          {workspace.agents.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Bot className="size-4 text-muted-foreground" />
                <Label>Agent Descriptions</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Describe each agent&apos;s role and capabilities so other agents know when to delegate work.
              </p>
              <div className="space-y-4">
                {workspace.agents.map((agent) => (
                  <AgentDescriptionField
                    key={agent.agentName}
                    agent={agent}
                    allAgentNames={workspace.agents.map((a) => a.agentName)}
                    value={descriptions[agent.agentName] || ''}
                    onChange={(v) => setDescriptions((prev) => ({ ...prev, [agent.agentName]: v }))}
                  />
                ))}
              </div>
            </div>
          )}

        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentDescriptionField({
  agent,
  allAgentNames,
  value,
  onChange,
}: {
  agent: WorkspaceAgent;
  allAgentNames: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const color = getAgentColor(agent.agentName, allAgentNames);
  const initials = getAgentInitials(agent.agentName);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div
          className="size-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
          style={{ backgroundColor: color.bg }}
        >
          {initials}
        </div>
        <span className="text-sm font-medium">{agent.agentName}</span>
        <span className="text-xs text-muted-foreground">
          {agent.agentType || 'unknown'} &middot; {agent.status}
        </span>
      </div>
      {agent.workingDir && (
        <p className="text-xs text-muted-foreground font-mono ml-8">
          {agent.workingDir}
        </p>
      )}
      <Textarea
        className="ml-8 text-sm min-h-[60px]"
        placeholder={`Describe what ${agent.agentName} does, e.g. "Manages the Python SDK codebase"`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
