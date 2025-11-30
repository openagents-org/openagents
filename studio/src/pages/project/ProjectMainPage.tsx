import React from "react"
import { Routes, Route } from "react-router-dom"
import ProjectChatRoom from "@/pages/messaging/components/ProjectChatRoom"

/**
 * Project main page
 * Route: /project/*
 *
 * This page provides project management and private chat room functionality
 * - Left side: Project list and New Project button
 * - Right side: Private chat room based on selected project ID
 */
const ProjectMainPage: React.FC = () => {
  return (
    <div className="h-full bg-white dark:bg-gray-900">
      <Routes>
        {/* Default route - display project list and selection prompt */}
        <Route index element={<ProjectChatRoom />} />

        {/* Specific project chat room - via projectId parameter */}
        <Route path=":projectId" element={<ProjectChatRoom />} />
      </Routes>
    </div>
  )
}

export default ProjectMainPage
