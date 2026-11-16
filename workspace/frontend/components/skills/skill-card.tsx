'use client';

import { ArrowRight, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { Skill } from './skill-types';
import { skillDescription } from './skill-utils';

// Explicit column counts per breakpoint rather than `auto-fill,minmax(…)`:
// auto-fill keeps packing columns as the viewport grows, so a 27" display ended
// up with nine ~260px cards per row. Stepping the count by breakpoint holds each
// card around 340-390px wide at every size.
export const GRID_CLASS =
  'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 2xl:gap-5 3xl:grid-cols-6';

/** A skill's logo tile; uploaded skills, which carry no logo, get a package mark. */
export function SkillLogo({ skill, size = 'md' }: { skill: Skill; size?: 'md' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center bg-muted/60',
        lg ? 'size-12 rounded-xl' : 'size-11 rounded-lg',
      )}
    >
      {skill.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={skill.logo} alt="" className={cn('object-contain dark:invert', lg ? 'size-7' : 'size-5.5')} />
      ) : (
        <Package className={cn('text-muted-foreground', lg ? 'size-7' : 'size-5.5')} />
      )}
    </div>
  );
}

/** Anthropic-authored skills are the curated "official" ones. */
export function OfficialBadge({ skill }: { skill: Skill }) {
  const t = useT();
  if (skill.author !== 'Anthropic') return null;
  return <Badge className="shrink-0">{t('skills.official')}</Badge>;
}

export function SkillCard({ skill, onSelect }: { skill: Skill; onSelect: (s: Skill) => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => onSelect(skill)}
      className="group rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full transition-shadow group-hover:shadow-md group-hover:ring-primary/30">
        <CardContent className="flex h-full flex-col gap-3">
          <div className="flex items-start gap-3.5">
            <SkillLogo skill={skill} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <h3 className="truncate text-sm leading-tight font-semibold">{skill.name}</h3>
                <OfficialBadge skill={skill} />
              </div>
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {skillDescription(t, skill)}
              </p>
            </div>
          </div>

          {/* Tags — aligned with the text column, past the logo */}
          {skill.tags.length > 0 && (
            <div className="ms-14.5 flex flex-wrap gap-1.5">
              {skill.tags.map(tag => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
          )}

          <div className="ms-14.5 mt-auto flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {skill.sourceRepo ? skill.sourceRepo.split('/')[0] : (skill.author || t('skills.customSource'))}
            </span>
            <span className="flex items-center gap-0.5 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
              {t('skills.view')} <ArrowRight className="size-3" />
            </span>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}
