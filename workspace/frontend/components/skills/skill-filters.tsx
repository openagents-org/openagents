'use client';

import { Search } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useT } from '@/lib/i18n';
import { CATEGORIES, categoryLabel } from './skill-utils';

/** Skill search; the header holds it on wide screens, the filter bar on narrow ones. */
export function SkillSearch({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const t = useT();
  return (
    <InputGroup className={className}>
      <InputGroupInput
        type="text"
        placeholder={t('skills.searchPlaceholder')}
        aria-label={t('skills.searchLabel')}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
    </InputGroup>
  );
}

/** One category at a time; the row scrolls sideways when it runs out of room. */
export function SkillCategoryFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const t = useT();
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={value}
      onValueChange={(v) => v && onChange(v)}
      className="no-scrollbar w-full justify-start overflow-x-auto pb-0.5"
    >
      {CATEGORIES.map(cat => (
        <ToggleGroupItem key={cat.id} value={cat.id} className="shrink-0 text-xs text-muted-foreground data-[state=on]:text-foreground">
          <span>{cat.icon}</span>
          {categoryLabel(t, cat.id)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
