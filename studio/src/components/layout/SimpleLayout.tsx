import React, { ReactNode, useContext, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import {
  OpenAgentsProvider,
  OpenAgentsContext,
} from "@/context/OpenAgentsProvider";
import { useAuthStore } from "@/stores/authStore";
import { LayoutProvider, useLayout } from "./components/context";
import { SidebarSecondary } from "./components/sidebar-secondary";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { Button } from "./ui/button";
import { Menu } from "lucide-react";

interface SimpleLayoutProps {
  children?: ReactNode;
}

// Conditionally rendered OpenAgents Provider wrapper
const ConditionalOpenAgentsProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const { selectedNetwork, agentName } = useAuthStore();

  // Only initialize OpenAgentsProvider after basic setup is complete
  if (selectedNetwork && agentName) {
    return <OpenAgentsProvider>{children}</OpenAgentsProvider>;
  }

  // If no network/agent selected, render children without provider
  // (Sidebar will handle this gracefully or won't be shown)
  return <>{children}</>;
};

/**
 * SimpleLayout - 简易的包裹布局组件
 * 用于包裹 dynamicRouteConfig 中的所有路由
 * 使用 Outlet 渲染子路由，确保路由切换时不会重新渲染整个布局
 */
const SimpleLayout: React.FC<SimpleLayoutProps> = ({ children }) => {
  return (
    <ConditionalOpenAgentsProvider>
      <SimpleLayoutContent>{children}</SimpleLayoutContent>
    </ConditionalOpenAgentsProvider>
  );
};

// Internal component that can access OpenAgentsContext
const SimpleLayoutContent: React.FC<SimpleLayoutProps> = ({ children }) => {
  const context = useContext(OpenAgentsContext);
  const { selectedNetwork, agentName } = useAuthStore();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Check if current route is admin route
  const isAdminRoute = location.pathname.startsWith("/admin");

  // Only show Sidebar if we have network/agent and context is available
  const shouldShowSidebar = selectedNetwork && agentName && context;

  // Close drawer when route changes on mobile
  React.useEffect(() => {
    if (isMobile) {
      setIsDrawerOpen(false);
    }
  }, [location.pathname, isMobile]);

  // If admin route, use LayoutProvider and include SidebarSecondary
  if (isAdminRoute && context) {
    return (
      <LayoutProvider>
        <div className="h-screen w-screen flex overflow-hidden bg-[#F4F4F5] dark:bg-gray-800 text-gray-900 dark:text-gray-100">
          {shouldShowSidebar && <Sidebar />}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Mobile menu button */}
            <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="
                    fixed top-4 left-4 z-30
                    md:hidden
                  "
                  aria-label="Open menu"
                >
                  <Menu className="w-6 h-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[85%] max-w-[400px] p-0">
                <LayoutProvider>
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <SidebarSecondary />
                  </div>
                </LayoutProvider>
              </SheetContent>
            </Sheet>

            {/* Main content area with secondary sidebar */}
            <div className="flex-1 flex overflow-hidden">
              <AdminContentArea>
                {children ? children : <Outlet />}
              </AdminContentArea>
            </div>
          </div>
        </div>
      </LayoutProvider>
    );
  }

  // Non-admin route: keep original layout
  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[#F4F4F5] dark:bg-gray-800 text-gray-900 dark:text-gray-100">
      {shouldShowSidebar && <Sidebar />}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto">
          {children ? children : <Outlet />}
        </div>
      </div>
    </div>
  );
};

// Component for admin route content area with SidebarSecondary
const AdminContentArea: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isSidebarOpen } = useLayout();

  return (
    <>
      {/* Secondary Sidebar */}
      {isSidebarOpen && (
        <div
          className="hidden md:block flex-shrink-0 rounded-xl overflow-hidden"
          style={{
            width:
              "calc(var(--sidebar-width) - var(--sidebar-collapsed-width))",
            margin: "10px 0",
          }}
        >
          <SidebarSecondary />
        </div>
      )}

      {/* Page Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-800">
        {/* Scrollable Content */}
        <div className="flex-1 overflow-auto bg-white dark:bg-gray-800">
          {children}
        </div>
      </div>
    </>
  );
};

export default SimpleLayout;
