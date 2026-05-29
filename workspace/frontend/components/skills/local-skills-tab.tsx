'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, FolderOpen, Download, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchLocalSkills, type LocalSkill } from '@/lib/api-skills';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const LOCAL_CATEGORIES = [
  { id: 'all', label: 'All', icon: '🔥' },
  { id: 'AI & Reasoning', label: 'AI & Reasoning', icon: '🧠' },
  { id: 'Design & UI', label: 'Design & UI', icon: '🎨' },
  { id: 'Dev Tools', label: 'Dev Tools', icon: '⚙️' },
  { id: 'Docs & Content', label: 'Docs & Content', icon: '📄' },
  { id: 'Integration & Automation', label: 'Integration', icon: '🔗' },
  { id: 'Media & Creative', label: 'Media', icon: '🎬' },
  { id: 'Web & Search', label: 'Web & Search', icon: '🌐' },
  { id: 'Data & Analysis', label: 'Data', icon: '📊' },
  { id: 'Engineering Practices', label: 'Engineering', icon: '🛠️' },
  { id: 'Life & Productivity', label: 'Life', icon: '🏠' },
  { id: 'System & CLI', label: 'System & CLI', icon: '🔧' },
];

// ---------------------------------------------------------------------------
// Skill Card
// ---------------------------------------------------------------------------

function LocalSkillCard({ skill, onSelect }: { skill: LocalSkill; onSelect: (s: LocalSkill) => void }) {
  return (
    <button
      className="text-left rounded-xl border border-border bg-card p-4 transition-all duration-150 hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => onSelect(skill)}
    >
      <div className="flex items-start gap-3">
        <div className="size-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0 text-base">
          {skill.categoryIcon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[13px] font-semibold leading-tight truncate">{skill.name}</h3>
            {skill.exists && (
              <span className="shrink-0 size-1.5 rounded-full bg-green-500" title="Installed locally" />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 mt-0.5">
            {skill.description || 'No description available'}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between mt-2.5 ml-12">
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
          {skill.category}
        </span>
        <span className="text-[10px] text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
          <FolderOpen className="size-2.5" /> Details
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface LocalSkillsTabProps {
  onSelectSkill: (skill: LocalSkill) => void;
}

export function LocalSkillsTab({ onSelectSkill }: LocalSkillsTabProps) {
  const [skills, setSkills] = useState<LocalSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    fetchLocalSkills()
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = skills;
    if (activeCategory !== 'all') {
      result = result.filter(s => s.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q)
      );
    }
    return result;
  }, [skills, search, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: skills.length };
    for (const s of skills) {
      counts[s.category] = (counts[s.category] || 0) + 1;
    }
    return counts;
  }, [skills]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading local skills...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search & Filters */}
      <div className="shrink-0 px-4 pt-3 pb-2 space-y-2.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search local skills..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-muted/50 border border-input placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Category chips */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
          {LOCAL_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                'shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors',
                activeCategory === cat.id
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="text-xs">{cat.icon}</span>
              <span>{cat.label}</span>
              {categoryCounts[cat.id] !== undefined && (
                <span className="text-[9px] opacity-60">({categoryCounts[cat.id]})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
            <Search className="size-8 opacity-30" />
            <p className="text-sm">No skills match your search</p>
            <button
              onClick={() => { setSearch(''); setActiveCategory('all'); }}
              className="text-xs text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Download className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {activeCategory === 'all' ? 'All Local Skills' : activeCategory}
              </span>
              <span className="text-[10px] text-muted-foreground">({filtered.length})</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
              {filtered.map(skill => (
                <LocalSkillCard key={skill.slug} skill={skill} onSelect={onSelectSkill} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
