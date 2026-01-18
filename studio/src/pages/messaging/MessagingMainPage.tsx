import React, { useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarHeader } from "@/components/layout/components/sidebar-header";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { useIsMobile } from "@/hooks/useMediaQuery";
import MessagingSidebar from "./MessagingSidebar";
import MessagingView from "./MessagingView";
import ProjectChatRoom from "./components/ProjectChatRoom";
/**
 * Messaging main page - Use chatStore unified architecture
 * Contains sidebar and main content area
 */
const MessagingMainPage: React.FC = () => {
  const isMobile = useIsMobile();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const location = useLocation();

  // Close drawer when route changes on mobile
  React.useEffect(() => {
    if (isMobile) {
      setIsDrawerOpen(false);
    }
  }, [location.pathname, isMobile]);

  // Sidebar content component
  const SidebarContent = () => (
    <div className=" bg-white dark:bg-zinc-950 overflow-hidden border-r border-gray-200 dark:border-gray-700 flex flex-col w-full h-full">
      <ScrollArea className="shrink-0 flex-1 mt-0 mb-2.5 h-full">
        <div className="h-full">
          <MessagingSidebar />
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div className="h-full flex overflow-hidden dark:bg-zinc-950 relative">
      {/* Mobile menu button */}
      {isMobile && (
        <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="fixed top-4 left-4 z-30 md:hidden"
              aria-label="Open menu"
            >
              <Menu className="w-6 h-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[85%] max-w-[400px] p-0">
            <SidebarContent />
          </SheetContent>
        </Sheet>
      )}

      {/* Desktop Sidebar */}
      {!isMobile && (
        <div 
          className="hidden md:block flex-shrink-0"
          style={{
            width: "calc(var(--sidebar-width) - var(--sidebar-collapsed-width))",
          }}
        >
          <SidebarContent />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-zinc-950">
        <Routes>
          {/* Project private chat room independent route */}
          <Route
            path="project/:projectId"
            element={<ProjectChatRoom />}
          />

          {/* Default chat view */}
          <Route
            index
            element={
              <MessagingView />
            }
          />

          {/* Other chat-related sub-routes can be added here */}
        </Routes>
      </div>
    </div>
  );
};

export default MessagingMainPage;
