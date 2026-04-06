import React, { useState } from "react"
import { Routes, Route, useLocation } from "react-router-dom"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Menu } from "lucide-react"
import { useMediaQuery } from "@/hooks/useMediaQuery"
import ProjectSidebar from "./ProjectSidebar"
import ProjectChatRoom from "@/pages/messaging/components/ProjectChatRoom"

/**
 * Project main page
 * Route: /project/*
 *
 * This page provides project management and private chat room functionality
 * - Left side: Project list and New Project button
 * - Right side: Private chat room based on selected project ID
 * Contains sidebar and main content area
 */
const ProjectMainPage: React.FC = () => {
  // Use 1024px breakpoint for this page since sidebar is 400px wide
  // This ensures tablet-sized screens (768px-1024px) use the drawer layout
  const isMobileOrTablet = useMediaQuery("(max-width: 1024px)")
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const location = useLocation()

  // Close drawer when route changes on mobile/tablet
  React.useEffect(() => {
    if (isMobileOrTablet) {
      setIsDrawerOpen(false)
    }
  }, [location.pathname, isMobileOrTablet])

  // Sidebar content component
  const SidebarContent = () => (
    <div className="lg:rounded-s-xl bg-white dark:bg-gray-800 overflow-hidden border-r border-gray-200 dark:border-gray-700 flex flex-col w-full h-full">
      <ScrollArea className="shrink-0 flex-1 mt-0 mb-2.5 h-full">
        <div className="h-full">
          <ProjectSidebar />
        </div>
      </ScrollArea>
    </div>
  )

  return (
    <div className="h-full flex overflow-hidden dark:bg-gray-800 relative">
      {/* Mobile/Tablet menu button and drawer */}
      {isMobileOrTablet && (
        <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="fixed top-4 left-4 z-30 lg:hidden"
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

      {/* Desktop Sidebar (only shown on lg screens and above) */}
      {!isMobileOrTablet && (
        <div
          className="hidden lg:block flex-shrink-0"
          style={{
            width: "calc(var(--sidebar-width) - var(--sidebar-collapsed-width))",
          }}
        >
          <SidebarContent />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-800">
        <Routes>
          {/* Default route - display project list and selection prompt */}
          <Route index element={<ProjectChatRoom />} />

          {/* Specific project chat room - via projectId parameter */}
          <Route path=":projectId" element={<ProjectChatRoom />} />
        </Routes>
      </div>
    </div>
  )
}

export default ProjectMainPage
