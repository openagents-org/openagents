'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Search, Upload } from 'lucide-react';
import { DetailHeader } from '@/components/layout/app-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { useT } from '@/lib/i18n';
import type { WorkspaceCustomSkill } from '@/lib/types';
import { GRID_CLASS, SkillCard } from './skill-card';
import { SkillDetailDialog } from './skill-detail-dialog';
import { SkillCategoryFilter, SkillSearch } from './skill-filters';
import { LeaderboardPanel } from './skill-leaderboard';
import type { Skill } from './skill-types';
import { skillDescription } from './skill-utils';
import { UploadSkillDialog } from './upload-skill-dialog';
import { useSkillLibrary } from './use-skill-library';

export function SkillsView() {
  const t = useT();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const { allSkills, customSkills, reloadCustomSkills, reloadRegistrySkills, addUploaded } =
    useSkillLibrary(search, activeCategory);

  const handleUploaded = (created: WorkspaceCustomSkill) => {
    addUploaded(created);
    setActiveCategory('custom');
  };

  const filtered = useMemo(() => {
    let result = allSkills;
    if (activeCategory !== 'all') result = result.filter(s => s.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        skillDescription(t, s).toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) || s.tags.some(tag => tag.toLowerCase().includes(q))
      );
    }
    return result;
  }, [search, activeCategory, allSkills, t]);

  const featured = useMemo(() => allSkills.filter(s => s.featured && s.sourceType !== 'workspace_file'), [allSkills]);
  const browsingAll = activeCategory === 'all' && !search;

  return (
    <div className="flex h-full flex-col">
      {/* Header — title (with the catalogue size) plus search and upload. The
          count describes the catalogue, not the actions, so it belongs beside
          the title, the way the thread list carries its unread count. */}
      <DetailHeader
        // Without this the desktop shell falls back to its own plain "Skill Hub"
        // text and this title — icon and count included — is never rendered.
        titleInHeader
        title={<>
          <h2 className="text-sm font-semibold">{t('skills.title')}</h2>
          <Badge variant="outline">{allSkills.length}</Badge>
        </>}
      >
        <div className="flex items-center gap-2">
          {/* Search only ever needs room for a skill name, not the page width */}
          <SkillSearch value={search} onChange={setSearch} className="hidden w-48 md:flex lg:w-56" />
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload data-icon="inline-start" />
            <span className="hidden sm:inline">{t('skills.uploadCustom')}</span>
          </Button>
        </div>
      </DetailHeader>

      {/* Filters */}
      <div className="flex shrink-0 flex-col gap-2 border-b px-4 py-2">
        {/* Narrow screens keep the search here — the mobile header has no room */}
        <SkillSearch value={search} onChange={setSearch} className="md:hidden" />
        <SkillCategoryFilter value={activeCategory} onChange={setActiveCategory} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search />
              </EmptyMedia>
              <EmptyTitle>{t('skills.noMatches')}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="link" size="sm" onClick={() => { setSearch(''); setActiveCategory('all'); }}>
                {t('skills.clearFilters')}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="flex flex-col gap-6 p-4">
            {browsingAll && <LeaderboardPanel onSelect={setSelectedSkill} />}

            {/* Featured — only when showing all */}
            {browsingAll && featured.length > 0 && (
              <SkillSection title={t('skills.featured')}>
                <div className={GRID_CLASS}>
                  {featured.map(skill => (
                    <SkillCard key={skill.id} skill={skill} onSelect={setSelectedSkill} />
                  ))}
                </div>
              </SkillSection>
            )}

            {/* All skills — a filtered view needs no heading, the filter bar says what it is */}
            <SkillSection title={browsingAll ? t('skills.all') : undefined} count={browsingAll ? allSkills.length : undefined}>
              <div className={GRID_CLASS}>
                {filtered.map(skill => (
                  <SkillCard key={skill.id} skill={skill} onSelect={setSelectedSkill} />
                ))}
              </div>
            </SkillSection>
          </div>
        )}
      </div>

      {selectedSkill && (
        <SkillDetailDialog
          skill={selectedSkill}
          onClose={() => setSelectedSkill(null)}
          onRegistryChanged={reloadRegistrySkills}
          onCustomChanged={reloadCustomSkills}
          publishedByMe={customSkills.some(s => s.registrySkillId === selectedSkill.id)}
        />
      )}
      <UploadSkillDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={handleUploaded} />
    </div>
  );
}

/** Section heading in the shadcn card-title scale, so the plain sections read
 *  as peers of the leaderboard card above them. */
function SkillSection({ title, count, children }: { title?: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      {title && (
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-base font-medium">{title}</h3>
          {count !== undefined && <Badge variant="secondary">{count}</Badge>}
        </div>
      )}
      {children}
    </section>
  );
}
