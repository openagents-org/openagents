'use client';

import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/ui/code-block';
import { useT } from '@/lib/i18n';
import type { Skill } from './skill-types';
import { categoryLabel, skillGitHubUrl } from './skill-utils';

const ALL_AGENTS = ['Claude Code', 'Codex', 'Cursor', 'Gemini CLI', 'OpenCode', 'VS Code', 'Roo Code'];
const MIRRORED_AGENTS = ['Claude Code', 'Codex', 'Cursor'];

/**
 * Everything known about a skill as one labelled list: what it is, who made
 * it, where it comes from and what runs it. One card with row dividers rather
 * than a card per fact, the way shadcn blocks lay out a record's details.
 */
export function SkillDetailsCard({ skill }: { skill: Skill }) {
  const t = useT();
  const isCustom = skill.sourceType === 'workspace_file';
  const isRegistry = skill.sourceType === 'registry';
  const ghUrl = skillGitHubUrl(skill);
  const mirrored = isRegistry && skill.sourceMode === 'mirrored';
  const packageType = skill.packageType || 'md';

  const rows: Array<{ key: string; label: string; value: ReactNode }> = [
    { key: 'category', label: t('skills.category'), value: categoryLabel(t, skill.category) },
    { key: 'author', label: t('skills.author'), value: skill.author || t('skills.customAuthor') },
  ];
  if (isRegistry) {
    rows.push(
      {
        key: 'namespace',
        label: t('skills.namespaceVersion'),
        value: `${skill.namespace}/${skill.slug} · ${skill.version || 'upstream'}`,
      },
      { key: 'license', label: t('skills.license'), value: skill.license || 'LicenseRef-Upstream' },
    );
  }
  if (isCustom) {
    rows.push({
      key: 'package',
      label: t('skills.uploadedPackage'),
      value: (
        <span className="flex items-center justify-end gap-2">
          <span className="truncate">{skill.filename || `${skill.id}.${packageType}`}</span>
          <Badge variant="secondary" className="uppercase">{packageType}</Badge>
        </span>
      ),
    });
  } else if (skill.sourceRepo) {
    rows.push({
      key: 'source',
      label: t('skills.source'),
      value: (
        <a
          href={ghUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1 underline-offset-4 hover:underline"
        >
          <span className="truncate">{skill.sourceRepo}/{skill.sourcePath}</span>
          <ExternalLink className="size-3 shrink-0" />
        </a>
      ),
    });
  }
  rows.push({
    key: 'compatible',
    label: t('skills.compatibleWith'),
    value: (
      <span className="flex flex-wrap items-center justify-end gap-1.5">
        {(mirrored ? MIRRORED_AGENTS : ALL_AGENTS).map(agent => (
          <Badge key={agent} variant="secondary">{agent}</Badge>
        ))}
        {(!isRegistry || skill.sourceMode === 'upstream_pointer') && (
          <span className="text-xs text-muted-foreground">{t('skills.moreCompatible')}</span>
        )}
      </span>
    ),
  });

  return (
    <Card size="sm">
      <CardContent>
        <dl className="flex flex-col divide-y">
          {rows.map(row => (
            <div key={row.key} className="flex items-start justify-between gap-6 py-2.5 first:pt-0 last:pb-0">
              <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 text-right">{row.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/** The one-line CLI install for skills that live in a GitHub repo. */
export function SkillCliInstall({ skill }: { skill: Skill }) {
  const t = useT();
  if (skill.sourceType === 'workspace_file' || !skill.sourceRepo) return null;
  const command = `npx @anthropic-ai/skills install ${skill.sourceRepo}/${skill.sourcePath}`;
  return (
    <CodeBlock size="sm">
      <CodeBlockHeader>
        <CodeBlockTitle>{t('skills.cliInstall')}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={command} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap>{command}</CodeBlockContent>
    </CodeBlock>
  );
}
