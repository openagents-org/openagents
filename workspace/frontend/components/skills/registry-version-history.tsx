'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { RegistrySkill } from '@/lib/types';
import type { Skill } from './skill-types';
import { useSkillActionLock } from './skill-action-lock';
import { extractErrorMessage } from './skill-utils';
import { SkillVersionTimeline } from './skill-version-timeline';

/** A public listing's published versions; its publisher may yank mirrored ones. */
export function RegistryVersionHistory({
  skill,
  publishedByMe,
  onRegistryChanged,
}: {
  skill: Skill;
  publishedByMe: boolean;
  onRegistryChanged: () => Promise<void>;
}) {
  const t = useT();
  const [detail, setDetail] = useState<RegistrySkill | null>(null);
  const { busy, run } = useSkillActionLock();
  const { namespace, slug } = skill;

  useEffect(() => {
    if (!namespace || !slug) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    workspaceApi.getRegistrySkill(namespace, slug)
      .then(next => { if (!cancelled) setDetail(next); })
      .catch(() => { /* the latest version shown on the card still works */ });
    return () => { cancelled = true; };
  }, [namespace, slug]);

  const yank = (versionId: string, version: string) => run(async () => {
    try {
      await workspaceApi.yankRegistryVersion(skill.id, versionId);
      if (namespace && slug) {
        setDetail(await workspaceApi.getRegistrySkill(namespace, slug).catch(() => null));
      }
      await onRegistryChanged();
      toast.success(t('skills.yankSuccess', { version }));
    } catch (e) {
      toast.error(extractErrorMessage(e));
    }
  });

  if (!detail?.versions?.length) return null;

  return (
    <SkillVersionTimeline
      title={t('skills.versionHistory')}
      versions={detail.versions.map(version => ({
        id: version.id,
        version: version.version,
        changelog: version.changelog,
        date: version.publishedAt,
        yanked: version.status === 'yanked',
        action: publishedByMe && version.status === 'published' && version.sourceMode === 'mirrored' ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => yank(version.id, version.version)}
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            {t('skills.yankVersion')}
          </Button>
        ) : undefined,
      }))}
    />
  );
}
