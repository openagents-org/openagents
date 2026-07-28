'use client';

import { useState, useEffect } from 'react';
import { Check, Copy, Crown, Globe, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerFooter,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceCollaborator } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from './layout-context';

export function SettingsDialog({ open, onOpenChange, workspace, refreshWorkspace }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspace: ReturnType<typeof useWorkspace>['workspace'];
  refreshWorkspace: () => Promise<void>;
}) {
  const [name, setName] = useState(workspace?.name || '');
  const [monitorMode, setMonitorMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const { isCopied: urlCopied, copyToClipboard: copyUrl } = useCopyToClipboard();
  const { isCopied: tokenCopied, copyToClipboard: copyToken } = useCopyToClipboard();
  const { notificationSound, setNotificationSound } = useWorkspace();
  const { splitBrowser, setSplitBrowser, isMobile } = useLayout();
  const [collabEmail, setCollabEmail] = useState('');
  const [collabAdding, setCollabAdding] = useState(false);
  const [collaborators, setCollaborators] = useState<WorkspaceCollaborator[]>([]);
  const [collabOwner, setCollabOwner] = useState<string | null>(null);
  const [bfApiKey, setBfApiKey] = useState('');

  useEffect(() => {
    if (open && workspace) {
      setName(workspace.name);
      setMonitorMode(!!(workspace.settings?.monitorMode));
      setBfApiKey('');
      workspaceApi.listCollaborators().then((d) => {
        setCollaborators(d.collaborators);
        setCollabOwner(d.owner);
      }).catch(() => {});
    }
  }, [open, workspace]);

  if (!workspace) return null;

  const workspaceUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/${workspace.slug}${window.location.search}`
    : '';

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const wsUpdates: Record<string, unknown> = { name: name.trim(), settings: { ...workspace.settings, monitorMode } };
      if (bfApiKey.trim()) wsUpdates.browserfabric_api_key = bfApiKey.trim();
      await workspaceApi.updateWorkspace(wsUpdates);
      await refreshWorkspace();
      toast.success('Settings saved');
      onOpenChange(false);
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const formBody = (
        <div className="space-y-6 py-1">
          <div className="space-y-2">
            <Label>Workspace Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Workspace" />
          </div>
          <div className="space-y-2">
            <Label variant="secondary">Workspace URL</Label>
            <div className="flex items-center gap-2">
              <Input value={workspaceUrl} readOnly className="text-xs font-mono" />
              <Button variant="outline" size="icon" onClick={() => copyUrl(workspaceUrl)}>
                {urlCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label variant="secondary">Workspace ID</Label>
            <div className="flex items-center gap-2">
              <Input value={workspace.slug} readOnly className="text-xs font-mono" />
              <Button variant="outline" size="icon" onClick={() => copyToken(workspace.slug)}>
                {tokenCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>

          {/* Experimental */}
          <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Label>Monitor Mode</Label>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  Experimental
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Show a 2x3 grid overview of recent threads instead of the thread list.
              </p>
            </div>
            <Switch checked={monitorMode} onCheckedChange={setMonitorMode} size="sm" />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
            <div className="space-y-0.5">
              <Label>Notification Sound</Label>
              <p className="text-xs text-muted-foreground">
                Play a sound when an agent completes a task.
              </p>
            </div>
            <Switch checked={notificationSound} onCheckedChange={setNotificationSound} size="sm" />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Label>Split Browser View</Label>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  Experimental
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Show browser tab side-by-side with chat when viewing threads.
              </p>
            </div>
            <Switch checked={splitBrowser} onCheckedChange={setSplitBrowser} size="sm" />
          </div>

          {/* Collaborators */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              <Label>Collaborators</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Add people by email. They can access this workspace by signing in.
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={collabEmail}
                onChange={(e) => setCollabEmail(e.target.value)}
                placeholder="colleague@example.com"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && collabEmail.trim()) {
                    setCollabAdding(true);
                    workspaceApi.addCollaborator(collabEmail.trim().toLowerCase(), 'editor')
                      .then(() => {
                        toast.success(`Added ${collabEmail.trim()}`);
                        setCollabEmail('');
                        return workspaceApi.listCollaborators();
                      })
                      .then((d) => setCollaborators(d.collaborators))
                      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'))
                      .finally(() => setCollabAdding(false));
                  }
                }}
                className="flex-1"
              />
              <Button
                onClick={() => {
                  if (!collabEmail.trim()) return;
                  setCollabAdding(true);
                  workspaceApi.addCollaborator(collabEmail.trim().toLowerCase(), 'editor')
                    .then(() => {
                      toast.success(`Added ${collabEmail.trim()}`);
                      setCollabEmail('');
                      return workspaceApi.listCollaborators();
                    })
                    .then((d) => setCollaborators(d.collaborators))
                    .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'))
                    .finally(() => setCollabAdding(false));
                }}
                disabled={collabAdding || !collabEmail.trim()}
                size="sm"
              >
                {collabAdding ? '...' : 'Add'}
              </Button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {collabOwner && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/30 text-sm">
                  <Crown className="size-3.5 text-amber-500 shrink-0" />
                  <span className="truncate flex-1">{collabOwner}</span>
                  <span className="text-xs text-muted-foreground">Owner</span>
                </div>
              )}
              {collaborators.map((c) => (
                <div key={c.email} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/30 text-sm">
                  <span className="truncate flex-1">{c.email}</span>
                  <button
                    onClick={() => {
                      workspaceApi.removeCollaborator(c.email)
                        .then(() => setCollaborators((prev) => prev.filter((x) => x.email !== c.email)))
                        .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'));
                    }}
                    className="size-5 flex items-center justify-center rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
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
              Each workspace gets a free-tier key automatically. Set a custom key to use your own BrowserFabric account.
            </p>
          </div>

        </div>
  );

  // ── Mobile: bottom drawer with pull-down-to-close (vaul) ──
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90vh] pb-[env(safe-area-inset-bottom)]">
          <DrawerHeader>
            <DrawerTitle>Workspace Settings</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>{formBody}</DrawerBody>
          <DrawerFooter className="flex-row pt-4 pb-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving || !name.trim()}>{saving ? 'Saving...' : 'Save'}</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  // ── Desktop: centered dialog ──
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Workspace Settings</DialogTitle></DialogHeader>
        <DialogBody>{formBody}</DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>{saving ? 'Saving...' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
