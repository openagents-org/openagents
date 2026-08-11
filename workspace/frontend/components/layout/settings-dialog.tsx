'use client';

import { useState, useEffect } from 'react';
import { Check, Copy, Crown, Globe, Languages, Users, X } from 'lucide-react';
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
import { AvatarSection } from '@/components/settings/avatar-section';
import { TeamSection } from '@/components/settings/team-section';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceCollaborator } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';
import { LOCALES, LOCALE_LABELS, isLocale, useI18n } from '@/lib/i18n';
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
  const { t, locale, setLocale, isAutoDetected } = useI18n();
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
      toast.success(t('settings.saved'));
      onOpenChange(false);
    } catch {
      toast.error(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const addCollaborator = () => {
    const email = collabEmail.trim().toLowerCase();
    if (!email) return;
    setCollabAdding(true);
    workspaceApi.addCollaborator(email, 'editor')
      .then(() => {
        toast.success(t('settings.collaboratorAdded', { email }));
        setCollabEmail('');
        return workspaceApi.listCollaborators();
      })
      .then((d) => setCollaborators(d.collaborators))
      .catch((e) => toast.error(e instanceof Error ? e.message : t('settings.collaboratorFailed')))
      .finally(() => setCollabAdding(false));
  };

  const formBody = (
        <div className="space-y-6 py-1">
          <div className="space-y-2">
            <Label>{t('settings.workspaceName')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.workspaceNamePlaceholder')} />
          </div>

          {/* Language — mirrored in the user menu, but this is where people look
              for it first. Applies immediately; not part of the Save action. */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Languages className="size-4 text-muted-foreground" />
              <Label>{t('language.label')}</Label>
            </div>
            <div className="flex flex-wrap gap-2">
              {LOCALES.map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={option === locale ? 'primary' : 'outline'}
                  onClick={() => { if (isLocale(option)) setLocale(option); }}
                >
                  {LOCALE_LABELS[option]}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {isAutoDetected ? t('language.autoHint') : t('language.description')}
            </p>
          </div>

          <div className="space-y-2">
            <Label variant="secondary">{t('settings.workspaceUrl')}</Label>
            <div className="flex items-center gap-2">
              <Input value={workspaceUrl} readOnly className="text-xs font-mono" />
              <Button variant="outline" size="icon" onClick={() => copyUrl(workspaceUrl)}>
                {urlCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label variant="secondary">{t('settings.workspaceId')}</Label>
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
                <Label>{t('settings.monitorMode')}</Label>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  {t('settings.experimental')}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settings.monitorModeHint')}
              </p>
            </div>
            <Switch checked={monitorMode} onCheckedChange={setMonitorMode} size="sm" />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
            <div className="space-y-0.5">
              <Label>{t('settings.notificationSound')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.notificationSoundHint')}
              </p>
            </div>
            <Switch checked={notificationSound} onCheckedChange={setNotificationSound} size="sm" />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Label>{t('settings.splitBrowser')}</Label>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  {t('settings.experimental')}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settings.splitBrowserHint')}
              </p>
            </div>
            <Switch checked={splitBrowser} onCheckedChange={setSplitBrowser} size="sm" />
          </div>

          {/* Team & enforced login (v1.0): role-based membership + the
              require-login switch. Shown here for the beta ALONGSIDE the legacy
              email collaborators list below — reconcile/remove the duplicate
              before shipping to release. */}
          {/* The signed-in user's own avatar. User-level, not workspace-level:
              it follows them into every workspace they're a member of. */}
          <AvatarSection />

          <TeamSection workspace={workspace} />

          {/* Collaborators (legacy email-based) */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              <Label>{t('settings.collaborators')}</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('settings.collaboratorsHint')}
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={collabEmail}
                onChange={(e) => setCollabEmail(e.target.value)}
                placeholder={t('settings.collaboratorPlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && collabEmail.trim()) addCollaborator();
                }}
                className="flex-1"
              />
              <Button
                onClick={addCollaborator}
                disabled={collabAdding || !collabEmail.trim()}
                size="sm"
              >
                {collabAdding ? '...' : t('settings.collaboratorAdd')}
              </Button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {collabOwner && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/30 text-sm">
                  <Crown className="size-3.5 text-amber-500 shrink-0" />
                  <span className="truncate flex-1">{collabOwner}</span>
                  <span className="text-xs text-muted-foreground">{t('settings.owner')}</span>
                </div>
              )}
              {collaborators.map((c) => (
                <div key={c.email} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/30 text-sm">
                  <span className="truncate flex-1">{c.email}</span>
                  <button
                    onClick={() => {
                      workspaceApi.removeCollaborator(c.email)
                        .then(() => setCollaborators((prev) => prev.filter((x) => x.email !== c.email)))
                        .catch((e) => toast.error(e instanceof Error ? e.message : t('settings.collaboratorFailed')));
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
              <Label>{t('settings.browserFabricKey')}</Label>
            </div>
            {workspace.browserfabricApiKey && (
              <p className="text-xs text-muted-foreground font-mono">
                {t('settings.browserFabricCurrent', { key: workspace.browserfabricApiKey })}
              </p>
            )}
            <Input
              value={bfApiKey}
              onChange={(e) => setBfApiKey(e.target.value)}
              placeholder={workspace.browserfabricApiKey ? t('settings.browserFabricReplace') : t('settings.browserFabricPlaceholder')}
              className="text-xs font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.browserFabricHint')}
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
            <DrawerTitle>{t('settings.title')}</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>{formBody}</DrawerBody>
          <DrawerFooter className="flex-row pt-4 pb-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving || !name.trim()}>{saving ? t('common.saving') : t('common.save')}</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  // ── Desktop: centered dialog ──
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[70vh]">
        <DialogHeader><DialogTitle>{t('settings.title')}</DialogTitle></DialogHeader>
        <DialogBody>{formBody}</DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>{saving ? t('common.saving') : t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
