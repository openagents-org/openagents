'use client';

import type { ReactNode } from 'react';
import { ExternalLink, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/lib/i18n';
import type { Skill } from './skill-types';
import { categoryLabel, skillGitHubUrl } from './skill-utils';

const ALL_AGENTS = ['Claude Code', 'Codex', 'Cursor', 'Gemini CLI', 'OpenCode', 'VS Code', 'Roo Code'];
const MIRRORED_AGENTS = ['Claude Code', 'Codex', 'Cursor'];

/** A labelled fact: the label small and muted, the value below it. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="text-xs font-medium tracking-wider uppercase">{label}</CardDescription>
        <CardTitle className="truncate">{children}</CardTitle>
      </CardHeader>
    </Card>
  );
}

/** A labelled block whose body is more than a single value. */
function Section({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Card size="sm" className={className}>
      <CardHeader>
        <CardDescription className="text-xs font-medium tracking-wider uppercase">{label}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Who made the skill and what it is: category, author, and for listings namespace and license. */
export function SkillMetaFacts({ skill }: { skill: Skill }) {
  const t = useT();
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Fact label={t('skills.category')}>{categoryLabel(t, skill.category)}</Fact>
        <Fact label={t('skills.author')}>{skill.author || t('skills.customAuthor')}</Fact>
      </div>

      {skill.sourceType === 'registry' && (
        <div className="grid grid-cols-2 gap-3">
          <Fact label={t('skills.namespaceVersion')}>
            {skill.namespace}/{skill.slug} · {skill.version || 'upstream'}
          </Fact>
          <Fact label={t('skills.license')}>{skill.license || 'LicenseRef-Upstream'}</Fact>
        </div>
      )}
    </>
  );
}

/** Where the skill comes from and what runs it: package or GitHub source, CLI install, compatibility. */
export function SkillSourceFacts({ skill }: { skill: Skill }) {
  const t = useT();
  const isCustom = skill.sourceType === 'workspace_file';
  const isRegistry = skill.sourceType === 'registry';
  const ghUrl = skillGitHubUrl(skill);
  const mirrored = isRegistry && skill.sourceMode === 'mirrored';

  return (
    <>

      {/* Custom (uploaded) skills show the uploaded package instead of a
          GitHub source / CLI install command. */}
      {isCustom ? (
        <Section label={t('skills.uploadedPackage')}>
          <div className="flex items-center gap-2">
            <Package className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{skill.filename || `${skill.id}.${skill.packageType || 'md'}`}</span>
            <Badge variant="secondary" className="shrink-0 uppercase">{skill.packageType || 'md'}</Badge>
          </div>
        </Section>
      ) : skill.sourceRepo && (
        <>
          <Section label={t('skills.source')}>
            <a href={ghUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
              {skill.sourceRepo}/{skill.sourcePath} <ExternalLink className="size-3" />
            </a>
          </Section>
          <Section label={t('skills.cliInstall')} className="bg-muted/30">
            <code className="block rounded-md border bg-background p-3 font-mono text-xs break-all select-all">
              npx @anthropic-ai/skills install {skill.sourceRepo}/{skill.sourcePath}
            </code>
          </Section>
        </>
      )}

      <Section label={t('skills.compatibleWith')}>
        <div className="flex flex-wrap gap-1.5">
          {(mirrored ? MIRRORED_AGENTS : ALL_AGENTS).map(a => (
            <Badge key={a} variant="secondary">{a}</Badge>
          ))}
          {(!isRegistry || skill.sourceMode === 'upstream_pointer') && (
            <span className="self-center text-xs text-muted-foreground">{t('skills.moreCompatible')}</span>
          )}
        </div>
      </Section>
    </>
  );
}
