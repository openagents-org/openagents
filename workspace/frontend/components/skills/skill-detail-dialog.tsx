'use client';

import { useCallback, useState } from 'react';
import { AlertTriangle, ExternalLink, EyeOff, GitFork, Globe2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { Spinner } from '@/components/ui/spinner';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { PrivateSkillVersions } from './private-skill-versions';
import { RegistryVersionHistory } from './registry-version-history';
import { SkillAgentInstalls } from './skill-agent-installs';
import { OfficialBadge, SkillLogo } from './skill-card';
import { SkillMetaFacts, SkillSourceFacts } from './skill-facts';
import { EMPTY_PUBLISH_DRAFT, SkillPublishForm, type PublishDraft } from './skill-publish-form';
import { SkillActionLockProvider, useSkillActionLock } from './skill-action-lock';
import type { Skill } from './skill-types';
import { extractErrorMessage, skillDescription, skillGitHubUrl } from './skill-utils';

interface SkillDetailDialogProps {
  skill: Skill;
  onClose: () => void;
  onRegistryChanged: () => Promise<void>;
  onCustomChanged: () => Promise<void>;
  /** True when this workspace holds the private skill that produced this
   *  public listing — the only client-side signal that we are the publisher. */
  publishedByMe: boolean;
}

export function SkillDetailDialog(props: SkillDetailDialogProps) {
  return (
    <SkillActionLockProvider>
      <SkillDetail {...props} />
    </SkillActionLockProvider>
  );
}

function SkillDetail({ skill, onClose, onRegistryChanged, onCustomChanged, publishedByMe }: SkillDetailDialogProps) {
  const isCustom = skill.sourceType === 'workspace_file';
  const isRegistry = skill.sourceType === 'registry';
  const ghUrl = skillGitHubUrl(skill);
  const { user: identityUser, isOpenAgentsDomain } = useOpenAgentsAuth();
  const t = useT();
  const { busy: acting, run } = useSkillActionLock();
  const [pending, setPending] = useState<'visibility' | 'fork' | 'publish' | null>(null);
  const [showPublishForm, setShowPublishForm] = useState(false);
  const [draft, setDraft] = useState<PublishDraft>(EMPTY_PUBLISH_DRAFT);
  const canPublish = isCustom && skill.packageType === 'md' && !!skill.workspaceSkillId;

  const handleVisibility = useCallback(async (visibility: 'public' | 'unlisted') => {
    // A custom skill card is keyed by its slug; the registry id is what the
    // moderation endpoints address.
    const registryId = skill.registrySkillId || skill.id;
    await run(async () => {
      setPending('visibility');
      try {
        await workspaceApi.setRegistrySkillVisibility(registryId, visibility);
        await Promise.all([onRegistryChanged(), onCustomChanged()]);
        toast.success(t(visibility === 'public' ? 'skills.relistSuccess' : 'skills.unlistSuccess',
          { skill: skill.name }));
        // The public listing disappears from search once unlisted, so its dialog
        // has nothing left to show.
        if (visibility === 'unlisted' && isRegistry) onClose();
      } catch (e) {
        toast.error(extractErrorMessage(e));
      } finally {
        setPending(null);
      }
    });
  }, [skill, isRegistry, onRegistryChanged, onCustomChanged, onClose, t, run]);

  const handleFork = useCallback(() => run(async () => {
    setPending('fork');
    try {
      await workspaceApi.forkRegistrySkill(skill.id, skill.versionId);
      await onCustomChanged();
      toast.success(t('skills.forkSuccess', { skill: skill.name }));
    } catch (e) {
      toast.error(extractErrorMessage(e));
    } finally {
      setPending(null);
    }
  }), [skill, onCustomChanged, t, run]);

  const handlePublish = () => run(async () => {
    if (!skill.workspaceSkillId || !draft.license) return;
    setPending('publish');
    try {
      const published = await workspaceApi.publishWorkspaceSkill(skill.workspaceSkillId, {
        license: draft.license,
        version: draft.version.trim() || undefined,
        changelog: draft.changelog.trim() || undefined,
      });
      toast.success(t('skills.publishSuccess', { skill: published.name }));
      await onRegistryChanged();
      setShowPublishForm(false);
      setDraft(EMPTY_PUBLISH_DRAFT);
    } catch (e) {
      toast.error(extractErrorMessage(e));
    } finally {
      setPending(null);
    }
  });

  const publishBlocked = !identityUser
    ? t(isOpenAgentsDomain ? 'skills.publishSignInRequired' : 'skills.publishUnavailableSelfHosted')
    : undefined;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-start gap-4">
            <SkillLogo skill={skill} size="lg" />
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center gap-2">
                <DialogTitle>{skill.name}</DialogTitle>
                <OfficialBadge skill={skill} />
              </div>
              <DialogDescription className="leading-relaxed">
                {skillDescription(t, skill)}
              </DialogDescription>
              {skill.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {skill.tags.map(tag => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {skill.unavailable && (
            <Alert className="border-warning/30 bg-warning/10 text-warning">
              <AlertTriangle />
              <AlertDescription className="text-warning">{t('skills.backingFileUnavailable')}</AlertDescription>
            </Alert>
          )}

          <SkillAgentInstalls skill={skill} />

          <SkillMetaFacts skill={skill} />

          {isRegistry && (
            <RegistryVersionHistory skill={skill} publishedByMe={publishedByMe} onRegistryChanged={onRegistryChanged} />
          )}

          {isCustom && skill.workspaceSkillId && (
            <PrivateSkillVersions workspaceSkillId={skill.workspaceSkillId} onCustomChanged={onCustomChanged} />
          )}

          {canPublish && showPublishForm && (
            <SkillPublishForm value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
          )}

          <SkillSourceFacts skill={skill} />
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" className="min-w-24" onClick={onClose}>
            {t('common.close')}
          </Button>
          {/* First press opens the publish fields in the body; the same pinned
              button then confirms, so it never scrolls out of reach. */}
          {canPublish && (
            <Button
              onClick={showPublishForm ? handlePublish : () => setShowPublishForm(true)}
              disabled={!!publishBlocked || acting || (showPublishForm && !draft.license)}
              title={publishBlocked}
              className="min-w-24"
            >
              {pending === 'publish' ? <Spinner data-icon="inline-start" /> : <Globe2 data-icon="inline-start" />}
              {publishBlocked ?? t(showPublishForm ? 'skills.publishConfirm' : 'skills.publishPublic')}
            </Button>
          )}
          {/* Publication state is managed from whichever copy the author can
              still reach: the public listing while it is public, and their own
              private skill once it has been unlisted. */}
          {((isRegistry && publishedByMe) || (isCustom && skill.registrySkillId)) && (
            <Button
              variant="outline"
              disabled={acting}
              onClick={() => handleVisibility(skill.visibility === 'unlisted' ? 'public' : 'unlisted')}
              className="min-w-24"
            >
              {pending === 'visibility' ? <Spinner data-icon="inline-start" /> : <EyeOff data-icon="inline-start" />}
              {t(skill.visibility === 'unlisted' ? 'skills.relistPublic' : 'skills.unlistPublic')}
            </Button>
          )}
          {isRegistry && skill.sourceMode === 'mirrored' && (
            <Button onClick={handleFork} disabled={acting} className="min-w-24">
              {pending === 'fork' ? <Spinner data-icon="inline-start" /> : <GitFork data-icon="inline-start" />}
              {t('skills.forkToWorkspace')}
            </Button>
          )}
          {!isCustom && ghUrl && (
            <Button asChild className="min-w-24">
              <a href={ghUrl} target="_blank" rel="noopener noreferrer">
                {t('skills.viewOnGitHub')} <ExternalLink data-icon="inline-end" />
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
