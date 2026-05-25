'use client';

/**
 * Tabbed right-side panel sitting next to the chat detail. Mirrors the
 * Swift `ContentSidebar` `[Content | Browser]` header tabs.
 *
 *   - Content tab: workspace files (FileList + FilePreview)
 *   - Browser tab: live Browser Fabric sessions (BrowserView). Hidden
 *     unless `workspace.browserEnabled === true` — mirrors
 *     `WorkspaceStore.browserPanelAvailable` on Swift.
 *
 * Width is user-resizable via the drag handle on the left edge.
 * Mirrors Swift's `sidebarResizeHandle` in ChatView. Bounds:
 *   - min: 280px (Swift's `ContentSidebar.singleColumnWidth`)
 *   - max: 50% of viewport width
 * The persisted width survives reloads via localStorage.
 *
 * Auto-rebound: if the user is parked on the Browser tab and the
 * workspace toggle gets flipped off, we bounce to Content.
 */

import { useCallback, useEffect, useRef } from 'react';
import { FileText, Globe, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLayout } from './layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { FileList } from '@/components/files/file-list';
import { FilePreview } from '@/components/files/file-preview';
import { BrowserView } from '@/components/browser/browser-view';

const MIN_WIDTH = 280;

export function RightTabbedPanel() {
  const {
    rightPanelOpen,
    setRightPanelOpen,
    rightPanelTab,
    setRightPanelTab,
    rightPanelWidth,
    setRightPanelWidth,
  } = useLayout();
  const { workspace, selectedFileId } = useWorkspace();

  const browserAvailable = !!workspace?.browserEnabled;

  useEffect(() => {
    if (!browserAvailable && rightPanelTab === 'browser') {
      setRightPanelTab('content');
    }
  }, [browserAvailable, rightPanelTab, setRightPanelTab]);

  // Clamp the persisted width into the current viewport (handles
  // shrinking the window below the previous 50% mark).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const maxWidth = window.innerWidth * 0.5;
    if (rightPanelWidth > maxWidth) {
      setRightPanelWidth(maxWidth);
    }
  }, [rightPanelWidth, setRightPanelWidth]);

  // Drag-to-resize. Dragging the handle left expands the panel; right
  // shrinks. We capture the start width on mousedown so the math stays
  // simple (no relative drift between renders).
  const dragStartRef = useRef<{ x: number; width: number } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartRef.current = { x: e.clientX, width: rightPanelWidth };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [rightPanelWidth],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const maxWidth = window.innerWidth * 0.5;
      const next = Math.min(
        Math.max(MIN_WIDTH, dragStartRef.current.width - (e.clientX - dragStartRef.current.x)),
        maxWidth,
      );
      setRightPanelWidth(next);
    };
    const onUp = () => {
      if (dragStartRef.current) {
        dragStartRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setRightPanelWidth]);

  if (!rightPanelOpen) return null;

  return (
    <aside
      className="relative shrink-0 bg-background border border-input rounded-xl shadow-xs overflow-hidden flex flex-col"
      style={{ width: `${rightPanelWidth}px` }}
    >
      {/* Drag handle — absolutely positioned over the panel's left edge
          so it lives inside the existing flex gap between chat and
          inspector (no extra column = no double gutter). 8px hit area
          centered on the seam; thin tinted line shows on hover.
          Mirrors Swift's `sidebarResizeHandle` shape. */}
      <div
        onMouseDown={onMouseDown}
        className="absolute -left-1.5 top-0 bottom-0 w-3 cursor-col-resize group z-10 flex items-stretch"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize content panel"
      >
        <div className="m-auto h-12 w-px bg-zinc-300/0 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-600 transition-colors" />
      </div>

        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-input shrink-0">
          <TabButton
            active={rightPanelTab === 'content'}
            onClick={() => setRightPanelTab('content')}
          >
            <FileText className="size-3.5" />
            <span>Content</span>
          </TabButton>
          {browserAvailable && (
            <TabButton
              active={rightPanelTab === 'browser'}
              onClick={() => setRightPanelTab('browser')}
            >
              <Globe className="size-3.5" />
              <span>Browser</span>
            </TabButton>
          )}
          <div className="flex-1" />
          <button
            onClick={() => setRightPanelOpen(false)}
            className="size-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Close panel"
            aria-label="Close right panel"
          >
            <X className="size-3.5" />
          </button>
        </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {rightPanelTab === 'content' ? (
          selectedFileId ? <FilePreview /> : <FileList />
        ) : (
          <BrowserView />
        )}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800',
      )}
    >
      {children}
    </button>
  );
}
