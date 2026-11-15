'use client';

import { useCallback, useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { WorkspaceSkillVersion } from '@/lib/types';
import { useSkillActionLock } from './skill-action-lock';
import { extractErrorMessage } from './skill-utils';
import { SkillVersionTimeline } from './skill-version-timeline';

/**
 * An uploaded skill's private version timeline and the form for the next one.
 * The public history only exists after publishing; this one is what an author
 * iterates on.
 */
export function PrivateSkillVersions({
  workspaceSkillId,
  onCustomChanged,
}: {
  workspaceSkillId: string;
  onCustomChanged: () => Promise<void>;
}) {
  const t = useT();
  const [versions, setVersions] = useState<WorkspaceSkillVersion[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [changelog, setChangelog] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { busy, run } = useSkillActionLock();
  // Bumped after a submit to remount (and so clear) the native file input.
  const [fileInputKey, setFileInputKey] = useState(0);

  const reload = useCallback(async () => {
    setVersions(await workspaceApi.getCustomSkillVersions(workspaceSkillId));
  }, [workspaceSkillId]);

  useEffect(() => {
    let cancelled = false;
    workspaceApi.getCustomSkillVersions(workspaceSkillId)
      .then(list => { if (!cancelled) setVersions(list); })
      .catch(() => { /* legacy skills without a normalized row have no timeline */ });
    return () => { cancelled = true; };
  }, [workspaceSkillId]);

  const submit = () => run(async () => {
    if (!file) return;
    setSubmitting(true);
    try {
      const created = await workspaceApi.createCustomSkillVersion(workspaceSkillId, file, changelog.trim());
      await reload();
      await onCustomChanged();
      setFile(null);
      setFileInputKey(k => k + 1);
      setChangelog('');
      toast.success(t('skills.newVersionSuccess', { version: created.version }));
    } catch (e) {
      toast.error(extractErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <>
      {versions.length > 0 && (
        <SkillVersionTimeline
          title={t('skills.privateVersionHistory')}
          versions={versions.map(version => ({
            id: version.versionId,
            version: version.version,
            changelog: version.changelog,
            date: version.createdAt,
          }))}
        />
      )}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-xs tracking-wider text-muted-foreground uppercase">{t('skills.newVersionTitle')}</CardTitle>
          <CardDescription className="text-xs">{t('skills.newVersionHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="skill-new-version-file" className="sr-only">{t('skills.newVersionTitle')}</FieldLabel>
              <Input
                key={fileInputKey}
                id="skill-new-version-file"
                type="file"
                accept=".md,.zip"
                onChange={event => setFile(event.target.files?.[0] || null)}
                className="text-xs"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="skill-new-version-changelog" className="sr-only">{t('skills.publishChangelogLabel')}</FieldLabel>
              <Input
                id="skill-new-version-changelog"
                value={changelog}
                maxLength={4000}
                onChange={event => setChangelog(event.target.value)}
                placeholder={t('skills.publishChangelogPlaceholder')}
              />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button size="sm" disabled={!file || busy} onClick={submit}>
            {submitting ? <Spinner data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
            {t('skills.newVersionSubmit')}
          </Button>
        </CardFooter>
      </Card>
    </>
  );
}
