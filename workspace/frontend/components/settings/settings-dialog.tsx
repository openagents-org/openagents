'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Settings, Copy, Check, Bot, Globe } from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { toast } from 'sonner';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import type { Workspace, WorkspaceAgent } from '@/lib/types';

interface SettingsDialogProps {
  workspace: Workspace | null;
}

export function SettingsDialog({ workspace }: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(workspace?.name || '');
  const [saving, setSaving] = useState(false);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [bfApiKey, setBfApiKey] = useState('');
  const { refreshWorkspace } = useWorkspace();
  const { isCopied: urlCopied, copyToClipboard: copyUrl } = useCopyToClipboard();
  const { isCopied: tokenCopied, copyToClipboard: copyToken } = useCopyToClipboard();

  // Sync descriptions from workspace agents when dialog opens
  useEffect(() => {
    if (open && workspace) {
      const descs: Record<string, string> = {};
      for (const agent of workspace.agents) {
        descs[agent.agentName] = agent.description || '';
      }
      setDescriptions(descs);
      setBfApiKey('');
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
      // Save workspace name + BF key
      const updates: Record<string, unknown> = { name: name.trim() };
      if (bfApiKey) updates.browserfabric_api_key = bfApiKey.trim();
      await workspaceApi.updateWorkspace(updates);

      // Save agent descriptions
      const descUpdates = workspace.agents.map((agent) => {
        const newDesc = descriptions[agent.agentName] ?? '';
        const oldDesc = agent.description || '';
        if (newDesc !== oldDesc) {
          return workspaceApi.updateMember(agent.agentName, { description: newDesc });
        }
        return null;
      }).filter(Boolean);

      await Promise.all(descUpdates);
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Workspace Settings</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-6 py-1">
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

          {/* Browser Fabric API Key */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Globe className="size-4 text-muted-foreground" />
              <Label>Browser Fabric API Key</Label>
            </div>
            {workspace.browserfabricApiKey && (
              <p className="text-xs text-muted-foreground font-mono">
                Current: {workspace.browserfabricApiKey}
              </p>
            )}
            <Input
              value={bfApiKey}
              onChange={(e) => setBfApiKey(e.target.value)}
              placeholder={workspace.browserfabricApiKey ? 'Enter new key to replace' : 'bf_... (optional — auto-provisioned if empty)'}
              className="text-xs font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Each workspace gets a free-tier key automatically. Set a custom key here to use your own BrowserFabric account.
            </p>
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
                    value={descriptions[agent.agentName] || ''}
                    onChange={(v) => setDescriptions((prev) => ({ ...prev, [agent.agentName]: v }))}
                  />
                ))}
              </div>
            </div>
          )}

        </DialogBody>

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
  value,
  onChange,
}: {
  agent: WorkspaceAgent;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <AgentAvatar name={agent.agentName} size={24} />
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
