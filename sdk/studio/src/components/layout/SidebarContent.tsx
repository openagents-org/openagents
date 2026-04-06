import React from "react"
import { useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import DefaultSidebar from "./DefaultSidebar"
import UserDashboardSidebar from "@/pages/profile/UserDashboardSidebar"
import ServiceAgentsSidebar from "@/pages/serviceagents/ServiceAgentsSidebar"
import AdminSidebar from "@/pages/admin/AdminSidebar"

// SidebarContent component - dynamically displays different sidebar content based on route
// Each specific sidebar component manages its own data, no need to pass from outside
const SidebarContent: React.FC = () => {
  const location = useLocation()
  const { t } = useTranslation('layout')

  // Decide which sidebar content to display based on current route
  const renderContent = () => {

    const pathname = location.pathname;

    // AgentWorld does not display sidebar
    if (pathname.startsWith("/agentworld")) {
      return <UserDashboardSidebar/>
    }

    // Messaging sidebar is now handled in MessagingMainPage, not here
    if (pathname.startsWith("/messaging")) {
      return <UserDashboardSidebar/>
    }

    // Project sidebar is now handled in ProjectMainPage, not here
    if (pathname.startsWith("/project")) {
      return <UserDashboardSidebar/>
    }

    // Feed sidebar is now handled in FeedMainPage, not here
    if (pathname.startsWith("/feed")) {
      return <UserDashboardSidebar/>
    }

    // Forum sidebar is now handled in ForumMainPage, not here
    if (pathname.startsWith("/forum")) {
      return <UserDashboardSidebar/>
    }

    // Wiki sidebar is now handled in WikiMainPage, not here
    if (pathname.startsWith("/wiki")) {
      return <UserDashboardSidebar/>
    }

    // Documents sidebar is now handled in DocumentsMainPage, not here
    if (pathname.startsWith("/documents")) {
      return <UserDashboardSidebar/>
    }

    // Artifact sidebar is now handled in ArtifactMainPage, not here
    if (pathname.startsWith("/artifact")) {
      return <UserDashboardSidebar/>
    }

    // Readme sidebar is now handled in ReadmeMainPage, not here
    if (pathname.startsWith("/readme")) {
      return <UserDashboardSidebar/>
    }

    if (pathname.startsWith("/settings")) {
      return (
        <DefaultSidebar
          message={t('defaultSidebar.settings')}
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

    if (pathname.startsWith("/admin")) {
      return <AdminSidebar />
    }

    if (pathname.startsWith("/user-dashboard")) {
      return null
    }

    // Profile sidebar is now handled in ProfileMainPage, not here
    if (pathname.startsWith("/profile")) {
      return <UserDashboardSidebar/>
    }

    if (pathname.startsWith("/studio/agents/service")) {
      return <ServiceAgentsSidebar />
    }

    if (pathname.startsWith("/mcp")) {
      return (
        <DefaultSidebar
          message={t('defaultSidebar.mcp')}
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

  return <div className="h-full flex flex-col">{renderContent()}</div>
}

export default React.memo(SidebarContent)
