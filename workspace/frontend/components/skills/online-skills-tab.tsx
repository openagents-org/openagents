'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, TrendingUp, Star, Download, ArrowRight, User, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchTopSkills, searchOnlineSkills, type OnlineSkill } from '@/lib/api-skills';

// ---------------------------------------------------------------------------
// Score Bar
// ---------------------------------------------------------------------------

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[9px] font-medium text-muted-foreground">{pct}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Online Skill Card
// ---------------------------------------------------------------------------

function OnlineSkillCard({ skill, onSelect }: { skill: OnlineSkill; onSelect: (s: OnlineSkill) => void }) {
  return (
    <button
      className="text-left rounded-xl border border-border bg-card p-4 transition-all duration-150 hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => onSelect(skill)}
    >
      <div className="flex items-start gap-3">
        <div className="size-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
          {skill.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={skill.iconUrl} alt="" className="size-5 object-contain rounded" />
          ) : (
            <Star className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[13px] font-semibold leading-tight truncate">{skill.name}</h3>
            {skill.score >= 0.8 && (
              <span className="shrink-0 text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-semibold uppercase">
                Top
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 mt-0.5">
            {skill.description}
          </p>
        </div>
      </div>

      {/* Tags */}
      {skill.tags && skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 ml-12">
          {skill.tags.slice(0, 4).map(tag => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
              {tag}
            </span>
          ))}
          {skill.tags.length > 4 && (
            <span className="text-[9px] text-muted-foreground">+{skill.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-2.5 ml-12">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
            <User className="size-2.5" /> {skill.ownerName || 'Community'}
          </span>
          <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
            <Download className="size-2.5" /> {formatCount(skill.downloads)}
          </span>
          {skill.stars > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
              <Star className="size-2.5" /> {formatCount(skill.stars)}
            </span>
          )}
        </div>
        <span className="text-[10px] text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
          View <ArrowRight className="size-2.5" />
        </span>
      </div>

      {/* Score */}
      {skill.score > 0 && (
        <div className="mt-2 ml-12">
          <ScoreBar score={skill.score} />
        </div>
      )}
    </button>
  );
}

function formatCount(n: number): string {
  if (!n) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface OnlineSkillsTabProps {
  onSelectSkill: (skill: OnlineSkill) => void;
}

export function OnlineSkillsTab({ onSelectSkill }: OnlineSkillsTabProps) {
  const [topSkills, setTopSkills] = useState<OnlineSkill[]>([]);
  const [searchResults, setSearchResults] = useState<OnlineSkill[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [visibleCount, setVisibleCount] = useState(12);

  // Load top skills on mount
  useEffect(() => {
    fetchTopSkills()
      .then(skills => setTopSkills(skills))
      .catch(() => setTopSkills([]))
      .finally(() => setLoading(false));
  }, []);

  // Debounced search
  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchOnlineSkills(search, 20);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [search]);

  const handleLoadMore = useCallback(() => {
    setVisibleCount(prev => prev + 12);
  }, []);

  const isSearchMode = search.trim().length > 0;
  const displaySkills = isSearchMode ? searchResults : topSkills.slice(0, visibleCount);
  const hasMore = !isSearchMode && visibleCount < topSkills.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading online skills...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="shrink-0 px-4 pt-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search online skills..."
            value={search}
            onChange={e => { setSearch(e.target.value); setVisibleCount(12); }}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-muted/50 border border-input placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground animate-spin" />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          {/* Section header */}
          <div className="flex items-center gap-2 mb-3">
            {isSearchMode ? (
              <>
                <Search className="size-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Search Results
                </span>
                <span className="text-[10px] text-muted-foreground">({searchResults.length})</span>
              </>
            ) : (
              <>
                <TrendingUp className="size-3.5 text-amber-500" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Top Skills
                </span>
                <span className="text-[10px] text-muted-foreground">({topSkills.length})</span>
              </>
            )}
          </div>

          {/* Skills grid */}
          {displaySkills.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
              <Search className="size-8 opacity-30" />
              <p className="text-sm">
                {isSearchMode ? 'No skills found for your search' : 'No top skills available'}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
                {displaySkills.map(skill => (
                  <OnlineSkillCard key={skill.slug} skill={skill} onSelect={onSelectSkill} />
                ))}
              </div>

              {/* Load More */}
              {hasMore && (
                <div className="flex justify-center mt-4">
                  <button
                    onClick={handleLoadMore}
                    className="px-4 py-2 text-xs font-medium text-primary bg-primary/5 hover:bg-primary/10 rounded-lg border border-primary/20 transition-colors"
                  >
                    Load More ({topSkills.length - visibleCount} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
