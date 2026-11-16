'use client';

import { useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useT } from '@/lib/i18n';

const LICENSES = ['MIT', 'Apache-2.0', 'CC-BY-4.0', 'CC-BY-SA-4.0'];

export interface PublishDraft {
  license: string;
  version: string;
  changelog: string;
}

export const EMPTY_PUBLISH_DRAFT: PublishDraft = { license: '', version: '', changelog: '' };

/**
 * The fields for publishing an uploaded skill to the public Registry. The
 * dialog's pinned footer confirms it, so the action stays in view however far
 * the body has scrolled.
 */
export function SkillPublishForm({
  value,
  onChange,
}: {
  value: PublishDraft;
  onChange: (patch: Partial<PublishDraft>) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  // Opened from the footer: bring the fields into view in the scrolling body.
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, []);

  return (
    <Card ref={ref} size="sm" className="bg-primary/5 ring-primary/30">
      <CardContent>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="skill-publish-license">{t('skills.publishLicenseLabel')}</FieldLabel>
            <Select value={value.license || undefined} onValueChange={(license) => onChange({ license })}>
              <SelectTrigger id="skill-publish-license" className="w-full bg-background">
                <SelectValue placeholder={t('skills.publishLicensePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {LICENSES.map(id => (
                    <SelectItem key={id} value={id}>{id}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>{t('skills.publishLicenseHint')}</FieldDescription>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="skill-publish-version">{t('skills.publishVersionLabel')}</FieldLabel>
              <Input
                id="skill-publish-version"
                value={value.version}
                maxLength={64}
                onChange={event => onChange({ version: event.target.value })}
                placeholder={t('skills.publishVersionPlaceholder')}
                className="bg-background"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="skill-publish-changelog">{t('skills.publishChangelogLabel')}</FieldLabel>
              <Input
                id="skill-publish-changelog"
                value={value.changelog}
                maxLength={4000}
                onChange={event => onChange({ changelog: event.target.value })}
                placeholder={t('skills.publishChangelogPlaceholder')}
                className="bg-background"
              />
            </Field>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
