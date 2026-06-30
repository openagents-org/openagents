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

/** On mobile, which pane is showing: the list or the detail */
export type MobilePane = 'list' | 'detail';

interface LayoutState {
  isMobile: boolean;
  isSidebarOpen: boolean;
  sidebarToggle: () => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  selectedAgentName: string | null;
  setSelectedAgentName: (name: string | null) => void;
  isAgentPanelOpen: boolean;
  /** Which pane is visible on mobile (ignored on desktop) */
  mobilePane: MobilePane;
  /** Navigate to detail pane on mobile */
  openMobileDetail: () => void;
  /** Navigate back to list pane on mobile */
  openMobileList: () => void;
  /** Whether the detail pane is expanded to full width (hides sidebar + list) */
  isDetailExpanded: boolean;
  toggleDetailExpanded: () => void;
  /** Experimental: show browser tab side-by-side with chat */
  splitBrowser: boolean;
  setSplitBrowser: (v: boolean) => void;
  /** Whether the browser live preview panel is currently showing */
  showBrowserPreview: boolean;
  setShowBrowserPreview: (v: boolean) => void;
}

const LayoutContext = createContext<LayoutState | undefined>(undefined);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('threads');
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>('list');
  const [isDetailExpanded, setIsDetailExpanded] = useState(false);
  const [splitBrowser, setSplitBrowser] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('x-split-browser') === '1';
  });

  const handleSetSplitBrowser = (v: boolean) => {
    setSplitBrowser(v);
    localStorage.setItem('x-split-browser', v ? '1' : '0');
  };

  const [showBrowserPreview, setShowBrowserPreview] = useState(false);

  const isAgentPanelOpen = selectedAgentName !== null;
  const openMobileDetail = () => setMobilePane('detail');
  const openMobileList = () => setMobilePane('list');
  const toggleDetailExpanded = () => setIsDetailExpanded((v) => !v);

  const cssVariables = useMemo(() => ({
    '--sidebar-width': '240px',
    '--sidebar-width-collapsed': '52px',
    '--header-height-mobile': '60px',
  } as React.CSSProperties), []);

  const sidebarToggle = () => setIsSidebarOpen((open) => !open);

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
  }, [cssVariables, isSidebarOpen]);

  return (
    <LayoutContext.Provider value={{
      isMobile,
      isSidebarOpen,
      sidebarToggle,
      viewMode,
      setViewMode,
      selectedAgentName,
      setSelectedAgentName,
      isAgentPanelOpen,
      mobilePane,
      openMobileDetail,
      openMobileList,
      isDetailExpanded,
      toggleDetailExpanded,
      splitBrowser,
      setSplitBrowser: handleSetSplitBrowser,
      showBrowserPreview,
      setShowBrowserPreview,
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
