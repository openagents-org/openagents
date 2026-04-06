import {
  createContext,
  ReactNode,
  useContext,
  useEffect,useState
} from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { TooltipProvider } from '@/components/ui/tooltip';

const PAGE_MARGIN = "10px";
const HEADER_HEIGHT = "60px";
const SIDEBAR_WIDTH = "280px";
const SIDEBAR_COLLAPSED_WIDTH = "60px";
const TOOLBAR_HEIGHT = "54px";

// Define the shape of the layout state
interface LayoutState {
  style: React.CSSProperties;
  bodyClassName: string;
  isMobile: boolean;
  isSidebarOpen: boolean;
  sidebarToggle: () => void;
}

// Create the context
const LayoutContext = createContext<LayoutState | undefined>(undefined);

// Provider component
interface LayoutProviderProps {
  children: ReactNode;
  style?: React.CSSProperties;
  bodyClassName?: string;
}

export function LayoutProvider({ children, style: customStyle, bodyClassName = '' }: LayoutProviderProps) {
  const isMobile = useIsMobile();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const defaultStyle: React.CSSProperties = {
    '--page-margin': PAGE_MARGIN,
    '--sidebar-width': SIDEBAR_WIDTH,
    '--sidebar-collapsed-width': SIDEBAR_COLLAPSED_WIDTH,
    '--header-height': HEADER_HEIGHT,
    '--toolbar-height': TOOLBAR_HEIGHT,
  } as React.CSSProperties;

  const style: React.CSSProperties = {
    ...defaultStyle,
    ...customStyle,
  };

  // Sidebar toggle function
  const sidebarToggle = () => setIsSidebarOpen((open) => !open);

  // Set body className on mount and clean up on unmount
  useEffect(() => {
    if (bodyClassName) {
      const body = document.body;
      const existingClasses = body.className;

      // Add new classes
      body.className = `${existingClasses} ${bodyClassName}`.trim();

      // Cleanup function to remove classes on unmount
      return () => {
        body.className = existingClasses;
      };
    }
  }, [bodyClassName]);

  return (
    <LayoutContext.Provider
      value={{
        bodyClassName,
        style,
        isMobile,
        isSidebarOpen,
        sidebarToggle
      }}
    >
      <div
        data-slot="layout-wrapper"
        className="flex grow"
        data-sidebar-open={isSidebarOpen}
        style={style}
      >
        <TooltipProvider delayDuration={0}>
          {children}
        </TooltipProvider>
      </div>
    </LayoutContext.Provider>
  );
}

// Custom hook for consuming the context
export const useLayout = () => {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
};
