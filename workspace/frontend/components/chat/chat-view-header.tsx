'use client';

import { useRef, useState } from 'react';
import { ChevronLeft, Cpu, Globe, Lock, PanelRight, Pencil, Share2, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { DetailHeader } from '@/components/layout/app-header';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { agentLabel } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import type { RoutineItem, WorkspaceSession } from '@/lib/types';
import { DmAvatars } from './dm-avatars';
import { ForkTag } from './fork-thread';
import { ThreadPrivacyControl, threadPrivacyApplies } from './thread-privacy-control';
import { ThreadParticipantCount } from './thread-participant-count';
import { AddThreadParticipants } from './add-thread-participants';
import { ResponseModeControl } from './response-mode-control';
import { ThreadSettings } from './thread-settings';
import { WithTooltip } from '@/components/ui/with-tooltip';

export type ChatViewDm = {
  isDM: boolean;
  counterpart: string | null;
  pairAddrs: string[];
  title: string | null;
  writable: boolean;
};

/** Thread header — on desktop the title lives in the shell's app header. */
export function ChatViewHeader({ sessionId, session, dm, onOpenProfile, canShare, onShare, routine, onEditRoutine }: {
  sessionId: string;
  session: WorkspaceSession | undefined;
  dm: ChatViewDm;
  onOpenProfile: (email: string) => void;
  canShare: boolean;
  onShare: () => void;
  routine: RoutineItem | null;
  onEditRoutine: (routine: RoutineItem) => void;
}) {
  const t = useT();
  const { agents, activeSessionIds, stoppingSessionIds, stopAllAgents, setSessionOrchestration } = useWorkspace();
  const { isMobile, openMobileList, splitBrowser, setSplitBrowser, showBrowserPreview, setShowBrowserPreview } = useLayout();
  const { isDM } = dm;
  const channel = !isDM && threadPrivacyApplies(sessionId) && session;
  const participants = session?.participants || [];
  const sessionAgents = agents.filter((a) => participants.includes(a.agentName));
  // Model chip — the model of the thread's leader (or its only agent).
  // Hidden when that agent runs on its own default.
  const leader = session?.master ? sessionAgents.find((a) => a.agentName === session.master) : null;
  const modelAgent = isDM ? null : leader || (sessionAgents.length === 1 ? sessionAgents[0] : null);
  const stopping = stoppingSessionIds.has(sessionId);
  const previewOpen = splitBrowser && showBrowserPreview;

  return (
    <DetailHeader
      titleInHeader={isDM}
      title={<>
        {/* Back button — mobile only */}
        {isMobile && (
          <Button variant="ghost" size="icon-sm" onClick={openMobileList} className="-ml-1 text-muted-foreground" aria-label={t('common.back')}>
            <ChevronLeft />
          </Button>
        )}
        {isDM ? <DmTitle dm={dm} onOpenProfile={onOpenProfile} /> : <ThreadTitle sessionId={sessionId} session={session} />}
        {!isDM && threadPrivacyApplies(sessionId) && session && (
          <span className="inline-flex shrink-0 text-muted-foreground" title={t(session.visibility === 'private' ? 'threadAccess.private' : 'threadAccess.public')} aria-label={t(session.visibility === 'private' ? 'threadAccess.private' : 'threadAccess.public')}>
            {session.visibility === 'private' ? <Lock className="size-3.5" /> : <Globe className="size-3.5" />}
          </span>
        )}
        {isMobile && !isDM && <ThreadParticipantCount channelName={sessionId} />}
        {sessionAgents.length > 1 && <Badge variant="secondary">{t('chat.groupBadge')}</Badge>}
      </>}
    >
      {modelAgent?.model && (
        <Badge variant="secondary" className="hidden max-w-44 sm:inline-flex" title={t('chat.modelBadgeTitle', { agent: agentLabel(modelAgent) })}>
          <Cpu />
          <span className="truncate font-mono">{modelAgent.model}</span>
        </Badge>
      )}

      {/* Stop button — visible when agents are working */}
      {(activeSessionIds.has(sessionId) || stopping) && (
        <Button variant="destructive" size="xs" onClick={() => stopAllAgents(sessionId)} disabled={stopping}>
          <Square data-icon="inline-start" className="fill-current" />
          {stopping ? t('chat.stopping') : t('chat.stop')}
        </Button>
      )}

      {channel && <AddThreadParticipants key={`add-participants:${sessionId}`} channelName={sessionId} />}

      {channel && !sessionId.startsWith('routines:') && (
        <ResponseModeControl key={`response-mode:${sessionId}`} session={channel} onChange={(updates) => setSessionOrchestration(sessionId, updates)} />
      )}

      {/* Thread access — Private/Public, owner, Join */}
      {channel && (
        <div className="mr-1 flex min-w-0 max-w-88 items-center gap-0.5">
          <ThreadPrivacyControl channelName={sessionId} joinOnly className="flex-nowrap whitespace-nowrap" />
        </div>
      )}

      {routine && (
        <Button variant="outline" size="sm" onClick={() => onEditRoutine(routine)} aria-label={t('routines.edit')}>
          <Pencil data-icon="inline-start" />
          <span className="hidden sm:inline">{t('routines.edit')}</span>
        </Button>
      )}

      {/* Personal assistant conversations cannot be shared. */}
      {canShare && (
        <WithTooltip label={t('chat.shareConversation')}>
          <Button variant="ghost" size="icon-sm" onClick={onShare} aria-label={t('chat.shareConversation')}>
            <Share2 />
          </Button>
        </WithTooltip>
      )}
      {channel && !sessionId.startsWith('routines:') && (
        <ThreadSettings key={`thread-settings:${sessionId}`} session={channel} />
      )}

      {/* Artifact preview toggle */}
      <WithTooltip label={previewOpen ? t('artifactPanel.close') : t('artifactPanel.open')}>
        <Toggle
          variant="outline"
          size="sm"
          pressed={previewOpen}
          onPressedChange={(open) => {
            if (!splitBrowser) setSplitBrowser(true);
            setShowBrowserPreview(open);
          }}
          aria-label={previewOpen ? t('artifactPanel.close') : t('artifactPanel.open')}
        >
          <PanelRight />
        </Toggle>
      </WithTooltip>
    </DetailHeader>
  );
}

function DmTitle({ dm, onOpenProfile }: { dm: ChatViewDm; onOpenProfile: (email: string) => void }) {
  const t = useT();
  const { setSelectedAgentName } = useLayout();
  const { counterpart } = dm;
  return (
    <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold">
      <DmAvatars addresses={counterpart ? [counterpart] : dm.pairAddrs} />
      <Button variant="ghost" size="sm" className="-mx-1 min-w-0 shrink px-1 text-sm font-semibold disabled:opacity-100" disabled={!counterpart} onClick={() => {
        if (counterpart?.startsWith('openagents:')) setSelectedAgentName(counterpart.slice('openagents:'.length));
        else if (counterpart?.startsWith('human:')) onOpenProfile(counterpart.slice('human:'.length));
      }}><span className="truncate">{dm.title}</span></Button>
      {!dm.writable && <Badge variant="secondary">{t('header.readOnly')}</Badge>}
    </h2>
  );
}

/** The thread title renames in place: activate to edit, Enter or blur to save. */
function ThreadTitle({ sessionId, session }: { sessionId: string; session: WorkspaceSession | undefined }) {
  const t = useT();
  const { renameSession } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const start = () => {
    setDraft(session?.title || '');
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };
  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== session?.title) renameSession(sessionId, trimmed);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        aria-label={t('threads.renameTitle')}
        className="h-8 min-w-0 max-w-xs font-semibold"
        autoFocus
      />
    );
  }
  return (
    <>
      <h2 className="flex min-w-0">
        <WithTooltip label={t('header.clickToRename')}>
          <Button variant="ghost" size="sm" onClick={start} className="-mx-1 min-w-0 shrink px-1 text-sm font-semibold">
            <span className="truncate">{session?.title || t('header.untitledThread')}</span>
          </Button>
        </WithTooltip>
      </h2>
      {session?.forkedFrom && <ForkTag forkedFrom={session.forkedFrom} />}
    </>
  );
}
