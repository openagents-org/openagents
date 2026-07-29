'use client';

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { TooltipProvider } from '@/components/ui/tooltip';

export type ViewMode = 'threads' | 'files' | 'knowledge' | 'browser' | 'tasks' | 'routines' | 'inbox' | 'connect' | 'skills';

/**
 * Views that render a list panel beside the icon rail. Everything else takes
 * over the full detail area, so the sidebar collapses down to the rail.
 */
export const VIEWS_WITH_LIST: ReadonlySet<ViewMode> = new Set<ViewMode>([
  'threads', 'files', 'browser', 'routines', 'knowledge',
]);

/**
 * Per-view list-panel preference, persisted in a cookie so it survives reloads
 * and is readable during SSR. Keyed by view because the habit differs per
 * surface — you might keep the thread list open but read files full-width.
 */
const LIST_PREFS_COOKIE = 'oa-list-open';
const LIST_PREFS_MAX_AGE = 60 * 60 * 24 * 365;

type ListPrefs = Partial<Record<ViewMode, boolean>>;

function readListPrefs(): ListPrefs {
  if (typeof document === 'undefined') return {};
  const match = document.cookie.match(new RegExp(`(?:^|; )${LIST_PREFS_COOKIE}=([^;]*)`));
  if (!match) return {};
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return {};
  }
}

function writeListPrefs(prefs: ListPrefs) {
  if (typeof document === 'undefined') return;
  const value = encodeURIComponent(JSON.stringify(prefs));
  document.cookie = `${LIST_PREFS_COOKIE}=${value}; path=/; max-age=${LIST_PREFS_MAX_AGE}; samesite=lax`;
}

/**
 * Whether the icon rail is expanded to show labels. Persisted the same way as
 * the list preference so the shell comes back the way it was left.
 */
const RAIL_COOKIE = 'oa-rail-expanded';

function readRailPref(): boolean {
  if (typeof document === 'undefined') return false;
  return new RegExp(`(?:^|; )${RAIL_COOKIE}=1`).test(document.cookie);
}

function writeRailPref(expanded: boolean) {
  if (typeof document === 'undefined') return;
  document.cookie = `${RAIL_COOKIE}=${expanded ? '1' : '0'}; path=/; max-age=${LIST_PREFS_MAX_AGE}; samesite=lax`;
}

/** On mobile, which pane is showing: the list or the detail */
export type MobilePane = 'list' | 'detail';

interface LayoutState {
  isMobile: boolean;
  /** Whether the list panel beside the rail is showing (the sidebar's open state) */
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarToggle: () => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  /** Switch view and open/collapse the list panel to match it */
  openView: (mode: ViewMode) => void;
  selectedAgentName: string | null;
  setSelectedAgentName: (name: string | null) => void;
  isAgentPanelOpen: boolean;
  /** Which pane is visible on mobile (ignored on desktop) */
  mobilePane: MobilePane;
  /** Navigate to detail pane on mobile */
  openMobileDetail: () => void;
  /** Navigate back to list pane on mobile */
  openMobileList: () => void;
  /** Whether the detail pane is expanded to full width (collapses the list panel) */
  isDetailExpanded: boolean;
  toggleDetailExpanded: () => void;
  /** Whether the current view has a list panel at all */
  hasListPanel: boolean;
  /** Whether the icon rail is widened to show its labels */
  isRailExpanded: boolean;
  toggleRail: () => void;
  /** Experimental: show browser tab side-by-side with chat */
  splitBrowser: boolean;
  setSplitBrowser: (v: boolean) => void;
  /** Whether the browser live preview panel is currently showing */
  showBrowserPreview: boolean;
  setShowBrowserPreview: (v: boolean) => void;
  /** Whether the New Thread dialog (agent picker) is open */
  newThreadOpen: boolean;
  setNewThreadOpen: (v: boolean) => void;
  /** Open the New Thread dialog so the user can pick agents for a new session */
  openNewThread: () => void;
}

const LayoutContext = createContext<LayoutState | undefined>(undefined);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const [viewMode, setViewMode] = useState<ViewMode>('threads');
  const [listPrefs, setListPrefs] = useState<ListPrefs>({});
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>('list');
  const [splitBrowser, setSplitBrowser] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('x-split-browser') === '1';
  });

  const handleSetSplitBrowser = (v: boolean) => {
    setSplitBrowser(v);
    localStorage.setItem('x-split-browser', v ? '1' : '0');
  };

  const [isRailExpanded, setIsRailExpanded] = useState(false);
  const [showBrowserPreview, setShowBrowserPreview] = useState(false);
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const openNewThread = () => setNewThreadOpen(true);

  // Read on mount rather than in the initial state, so the server render and the
  // first client render agree before the stored preference is applied.
  useEffect(() => {
    setListPrefs(readListPrefs());
    setIsRailExpanded(readRailPref());
  }, []);

  // Persist outside the state updater: React may run an updater more than once
  // (StrictMode, concurrent renders), and writing a cookie from there is a
  // side effect in the render phase.
  const toggleRail = () => {
    const next = !isRailExpanded;
    setIsRailExpanded(next);
    writeRailPref(next);
  };

  const isAgentPanelOpen = selectedAgentName !== null;
  const openMobileDetail = () => setMobilePane('detail');
  const openMobileList = () => setMobilePane('list');

  // In the app-shell-4 layout the list lives *inside* the sidebar, so
  // "expand the detail pane" and "collapse the sidebar" are the same gesture.
  const hasListPanel = VIEWS_WITH_LIST.has(viewMode);
  // Default to open the first time a view is used; after that the user's own
  // choice for that view wins.
  const isSidebarOpen = hasListPanel ? listPrefs[viewMode] ?? true : false;

  const setSidebarOpen = (open: boolean) => {
    if (!hasListPanel) return; // nothing to remember for full-width views
    const next = { ...listPrefs, [viewMode]: open };
    setListPrefs(next);
    writeListPrefs(next);
  };

  const isDetailExpanded = !isSidebarOpen;
  const toggleDetailExpanded = () => setSidebarOpen(!isSidebarOpen);
  const sidebarToggle = () => setSidebarOpen(!isSidebarOpen);

  // Switching views keeps whatever the user last chose for the target view.
  const openView = (mode: ViewMode) => {
    setViewMode(mode);
    setMobilePane('list');
  };

  // Sidebar widths now come from <SidebarProvider> (components/ui/sidebar).
  const cssVariables = useMemo(() => ({
    '--header-height-mobile': '60px',
  } as React.CSSProperties), []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    Object.entries(cssVariables).forEach(([prop, val]) => {
      html.style.setProperty(prop, val as string);
    });

    body.setAttribute('data-sidebar-open', isSidebarOpen.toString());

    return () => {
      Object.keys(cssVariables).forEach((prop) => {
        html.style.removeProperty(prop);
      });
      body.removeAttribute('data-sidebar-open');
    };
    // `data-sidebar-open` is kept on <body> so page-level styles can react to
    // the rail state even though the sidebar itself owns the widths now.
  }, [cssVariables, isSidebarOpen]);

  return (
    <LayoutContext.Provider value={{
      isMobile,
      isSidebarOpen,
      setSidebarOpen,
      sidebarToggle,
      viewMode,
      setViewMode,
      openView,
      selectedAgentName,
      setSelectedAgentName,
      isAgentPanelOpen,
      mobilePane,
      openMobileDetail,
      openMobileList,
      isDetailExpanded,
      toggleDetailExpanded,
      hasListPanel,
      isRailExpanded,
      toggleRail,
      splitBrowser,
      setSplitBrowser: handleSetSplitBrowser,
      showBrowserPreview,
      setShowBrowserPreview,
      newThreadOpen,
      setNewThreadOpen,
      openNewThread,
    }}>
      <div data-slot="layout-wrapper" className="flex grow">
        <TooltipProvider delayDuration={0}>
          {children}
        </TooltipProvider>
      </div>
    </LayoutContext.Provider>
  );
}

export const useLayout = () => {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
};
