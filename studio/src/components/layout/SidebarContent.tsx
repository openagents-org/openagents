import React from "react"
import { useLocation } from "react-router-dom"
import DefaultSidebar from "./DefaultSidebar"
import MessagingSidebar from "@/pages/messaging/MessagingSidebar"
import DocumentsSidebar from "@/pages/documents/DocumentsSidebar"
import ForumSidebar from "@/pages/forum/ForumSidebar"
import WikiSidebar from "@/pages/wiki/WikiSidebar"
import ProfileSidebar from "@/pages/profile/ProfileSidebar"
import ProjectSidebar from "@/pages/project/ProjectSidebar"
import FeedSidebar from "@/pages/feed/FeedSidebar"
import ArtifactSidebar from "@/pages/artifact/ArtifactSidebar"
import ReadmeSidebar from "@/pages/readme/ReadmeSidebar"

// SidebarContent component - dynamically displays different sidebar content based on route
// Each specific sidebar component manages its own data, no need to pass from outside
const SidebarContent: React.FC = () => {
  const location = useLocation()

  // Decide which sidebar content to display based on current route
  const renderContent = () => {

    const pathname = location.pathname;

    // AgentWorld 不显示侧边栏
    if (pathname.startsWith("/agentworld")) {
      return null
    }

    if (pathname.startsWith("/messaging")) {
      return <MessagingSidebar />
    }

    if (pathname.startsWith("/project")) {
      // ProjectSidebar gets needed data through hooks itself
      return <ProjectSidebar />
    }

    if (pathname.startsWith("/feed")) {
      return <FeedSidebar />
    }

    if (pathname.startsWith("/forum")) {
      // ForumSidebar gets needed data through hooks itself
      return <ForumSidebar />
    }

    if (pathname.startsWith("/wiki")) {
      // WikiSidebar gets needed data through hooks itself
      return <WikiSidebar />
    }

    if (pathname.startsWith("/documents")) {
      // DocumentsSidebar gets needed data through hooks itself
      return <DocumentsSidebar />
    }

    if (pathname.startsWith("/artifact")) {
      // ArtifactSidebar gets needed data through hooks itself
      return <ArtifactSidebar />
    }

    if (pathname.startsWith("/readme")) {
      // ReadmeSidebar gets needed data through hooks itself
      return <ReadmeSidebar />
    }

    if (pathname.startsWith("/settings")) {
      return (
        <DefaultSidebar
          message="Settings options will appear here"
          icon={
            <svg
              className="w-8 h-8 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          }
        />
      )
    }

    if (pathname.startsWith("/profile")) {
      return <ProfileSidebar />
    }

    if (pathname.startsWith("/mcp")) {
      return (
        <DefaultSidebar
          message="MCP plugins will appear here"
          icon={
            <svg
              className="w-8 h-8 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
              />
            </svg>
          }
        />
      )
    }

    // Default case
    return <DefaultSidebar />
  }

  return <div className="h-full overflow-y-auto">{renderContent()}</div>
}

export default React.memo(SidebarContent)
