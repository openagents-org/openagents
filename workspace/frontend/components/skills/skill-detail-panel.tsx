'use client';

import { ExternalLink, X, Download, Star, User, Tag, FolderOpen, Globe } from 'lucide-react';
import { type LocalSkill, type OnlineSkill } from '@/lib/api-skills';

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isOnlineSkill(skill: LocalSkill | OnlineSkill): skill is OnlineSkill {
  return 'ownerName' in skill || 'downloads' in skill;
}

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

interface SkillDetailPanelProps {
  skill: LocalSkill | OnlineSkill;
  onClose: () => void;
}

export function SkillDetailPanel({ skill, onClose }: SkillDetailPanelProps) {
  const online = isOnlineSkill(skill);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-x-4 top-[5%] bottom-[5%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[480px] bg-background rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden border border-border">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="size-12 rounded-xl bg-muted/60 flex items-center justify-center shrink-0">
              {online && (skill as OnlineSkill).iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={(skill as OnlineSkill).iconUrl} alt="" className="size-7 object-contain rounded" />
              ) : (
                <span className="text-xl">
                  {online ? '🌐' : (skill as LocalSkill).categoryIcon || '📦'}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold truncate">{skill.name}</h2>
                {online && (skill as OnlineSkill).score >= 0.8 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-semibold uppercase">
                    Top Rated
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{skill.description}</p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 size-7 rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
            >
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {/* Tags */}
          {online && (skill as OnlineSkill).tags && (skill as OnlineSkill).tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(skill as OnlineSkill).tags.map(tag => (
                <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium flex items-center gap-1">
                  <Tag className="size-2.5" /> {tag}
                </span>
              ))}
            </div>
          )}

          {/* Stats grid (online) */}
          {online && (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-border p-2.5 text-center">
                <Download className="size-3.5 mx-auto text-muted-foreground mb-1" />
                <div className="text-sm font-semibold">{(skill as OnlineSkill).downloads?.toLocaleString() || 0}</div>
                <div className="text-[9px] text-muted-foreground">Downloads</div>
              </div>
              <div className="rounded-lg border border-border p-2.5 text-center">
                <Star className="size-3.5 mx-auto text-amber-500 mb-1" />
                <div className="text-sm font-semibold">{(skill as OnlineSkill).stars?.toLocaleString() || 0}</div>
                <div className="text-[9px] text-muted-foreground">Stars</div>
              </div>
              <div className="rounded-lg border border-border p-2.5 text-center">
                <Globe className="size-3.5 mx-auto text-muted-foreground mb-1" />
                <div className="text-sm font-semibold">{(skill as OnlineSkill).installs?.toLocaleString() || 0}</div>
                <div className="text-[9px] text-muted-foreground">Installs</div>
              </div>
            </div>
          )}

          {/* Score bar (online) */}
          {online && (skill as OnlineSkill).score > 0 && (
            <div className="rounded-lg border border-border p-3">
              <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Relevance Score</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all"
                    style={{ width: `${Math.round((skill as OnlineSkill).score * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-semibold">{Math.round((skill as OnlineSkill).score * 100)}%</span>
              </div>
            </div>
          )}

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border p-2.5">
              <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Category</div>
              <div className="text-xs font-medium">{skill.category || 'Uncategorized'}</div>
            </div>
            {online ? (
              <div className="rounded-lg border border-border p-2.5">
                <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Author</div>
                <div className="text-xs font-medium flex items-center gap-1">
                  <User className="size-3" /> {(skill as OnlineSkill).ownerName || 'Unknown'}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border p-2.5">
                <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Status</div>
                <div className="text-xs font-medium flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-green-500" />
                  Installed Locally
                </div>
              </div>
            )}
          </div>

          {/* Version (online) */}
          {online && (skill as OnlineSkill).version && (
            <div className="rounded-lg border border-border p-2.5">
              <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Version</div>
              <div className="text-xs font-medium font-mono">{(skill as OnlineSkill).version}</div>
            </div>
          )}

          {/* Local: file path */}
          {!online && (
            <div className="rounded-lg border border-border p-2.5">
              <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">File Path</div>
              <code className="text-[11px] font-mono text-muted-foreground break-all">
                ~/.claude/skills/{skill.slug}
              </code>
            </div>
          )}

          {/* Slug */}
          <div className="rounded-lg border border-border p-3 bg-muted/30">
            <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Skill Slug</div>
            <code className="text-[11px] font-mono block bg-background rounded-md p-2.5 border border-border select-all">
              {skill.slug}
            </code>
          </div>

          {/* Chinese description */}
          {online && (skill as OnlineSkill).descriptionZh && (
            <div className="rounded-lg border border-border p-2.5">
              <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">中文描述</div>
              <p className="text-xs text-foreground">{(skill as OnlineSkill).descriptionZh}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Close
          </button>
          {online ? (
            <a
              href={`https://skillhub.cn/skills/${skill.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              View on SkillHub <ExternalLink className="size-3" />
            </a>
          ) : (
            <div className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-muted text-foreground text-xs font-medium">
              <FolderOpen className="size-3" /> Local Skill
            </div>
          )}
        </div>
      </div>
    </>
  );
}
