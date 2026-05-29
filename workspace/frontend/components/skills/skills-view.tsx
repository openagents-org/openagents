'use client';

import { useState } from 'react';
import { Sparkles, Monitor, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LocalSkillsTab } from './local-skills-tab';
import { OnlineSkillsTab } from './online-skills-tab';
import { SkillDetailPanel } from './skill-detail-panel';
import { type LocalSkill, type OnlineSkill } from '@/lib/api-skills';

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabId = 'local' | 'online';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'local', label: 'Local Skills', icon: <Monitor className="size-3.5" /> },
  { id: 'online', label: 'Online Hub', icon: <Globe className="size-3.5" /> },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function SkillsView() {
  const [activeTab, setActiveTab] = useState<TabId>('local');
  const [selectedSkill, setSelectedSkill] = useState<LocalSkill | OnlineSkill | null>(null);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-5 pt-4 pb-0 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="size-4 text-amber-500" />
          <h2 className="text-sm font-semibold">Skill Hub</h2>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-colors border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'bg-primary/10 text-primary border-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent',
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'local' ? (
          <LocalSkillsTab onSelectSkill={setSelectedSkill} />
        ) : (
          <OnlineSkillsTab onSelectSkill={setSelectedSkill} />
        )}
      </div>

      {/* Detail Panel */}
      {selectedSkill && (
        <SkillDetailPanel skill={selectedSkill} onClose={() => setSelectedSkill(null)} />
      )}
    </div>
  );
}
