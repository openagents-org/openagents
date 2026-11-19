'use client';

import { Fragment, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item';
import { useT } from '@/lib/i18n';

export interface TimelineVersion {
  id: string;
  version: string;
  changelog?: string | null;
  date?: string | null;
  yanked?: boolean;
  /** Per-version action, e.g. yank for the publisher. */
  action?: ReactNode;
}

/** A newest-first list of versions with their changelogs. */
export function SkillVersionTimeline({ title, versions }: { title: string; versions: TimelineVersion[] }) {
  const t = useT();
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Rows are split by separators alone, so drop the group gap (set by a
            has-[size] variant, which a plain gap-0 would not beat) and the separator margin. */}
        <ItemGroup className="has-data-[size=xs]:gap-0">
          {versions.map((version, index) => (
            <Fragment key={version.id}>
              {index > 0 && <ItemSeparator className="my-0" />}
              <Item size="xs" className="px-0">
                <ItemContent>
                  <ItemTitle>
                    v{version.version}
                    {index === 0 && <Badge variant="outline">{t('skills.latest')}</Badge>}
                    {version.yanked && <Badge variant="outline">{t('skills.yanked')}</Badge>}
                  </ItemTitle>
                  {/* Release notes are read in full here; there is nowhere else to expand them. */}
                  {version.changelog && <ItemDescription className="line-clamp-none">{version.changelog}</ItemDescription>}
                </ItemContent>
                {(version.date || version.action) && (
                  <ItemActions>
                    {version.date && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(version.date).toLocaleDateString()}
                      </span>
                    )}
                    {version.action}
                  </ItemActions>
                )}
              </Item>
            </Fragment>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}
