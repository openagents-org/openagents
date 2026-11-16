'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
        <CardTitle className="text-xs tracking-wider text-muted-foreground uppercase">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {versions.map((version, index) => (
          <div key={version.id} className="flex items-start gap-3 text-sm">
            <div className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="font-medium">v{version.version}</span>
                {index === 0 && <Badge variant="outline">{t('skills.latest')}</Badge>}
                {version.yanked && <Badge variant="outline">{t('skills.yanked')}</Badge>}
              </div>
              {version.changelog && <p className="text-xs text-muted-foreground">{version.changelog}</p>}
            </div>
            {version.date && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(version.date).toLocaleDateString()}
              </span>
            )}
            {version.action}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
