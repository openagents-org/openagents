'use client';

import { Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

const LOGO_SIZES = {
  sm: { box: 'size-8 rounded-md', mark: 'size-4' },
  md: { box: 'size-11 rounded-lg', mark: 'size-5.5' },
  lg: { box: 'size-12 rounded-xl', mark: 'size-7' },
} as const;

/** A skill's logo tile; uploaded skills, which carry no logo, get a package mark. */
export function SkillLogo({ skill, size = 'md' }: { skill: Skill; size?: keyof typeof LOGO_SIZES }) {
  const { box, mark } = LOGO_SIZES[size];
  return (
    <div className={cn('flex shrink-0 items-center justify-center bg-muted/60', box)}>
      {skill.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={skill.logo} alt="" className={cn('object-contain dark:invert', mark)} />
      ) : (
        <Package className={cn('text-muted-foreground', mark)} />
      )}
    </div>
  );
}

/** Anthropic-authored skills are the curated "official" ones. A label, not a
 *  call to action, so it takes the quiet outline badge. */
export function OfficialBadge({ skill }: { skill: Skill }) {
  const t = useT();
  if (skill.author !== 'Anthropic') return null;
  return <Badge variant="outline" className="shrink-0">{t('skills.official')}</Badge>;
}

/** The whole card opens the skill; hover only tints it, so nothing depends on
 *  a hover that touch screens never fire. */
export function SkillCard({ skill, onSelect }: { skill: Skill; onSelect: (s: Skill) => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => onSelect(skill)}
      className="group rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full gap-3 transition-colors group-hover:bg-muted/50">
        <CardHeader className="flex items-start gap-3">
          <SkillLogo skill={skill} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <span className="truncate">{skill.name}</span>
              <OfficialBadge skill={skill} />
            </CardTitle>
            <CardDescription className="line-clamp-2 text-xs leading-relaxed">
              {skillDescription(t, skill)}
            </CardDescription>
          </div>
        </CardHeader>
        {skill.tags.length > 0 && (
          <CardContent className="flex flex-wrap gap-1.5">
            {skill.tags.map(tag => (
              <Badge key={tag} variant="secondary">{tag}</Badge>
            ))}
          </CardContent>
        )}
        <CardContent className="mt-auto text-xs text-muted-foreground">
          {skill.sourceRepo ? skill.sourceRepo.split('/')[0] : (skill.author || t('skills.customSource'))}
        </CardContent>
      </Card>
    </button>
  );
}
