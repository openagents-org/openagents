import React from "react"
import { Routes, Route } from "react-router-dom"
import ForumTopicList from "@/components/forum/ForumTopicList"
import ForumTopicDetail from "@/components/forum/ForumTopicDetail"

/**
 * Forum main page - Handle all Forum-related features
 * Simplified layout with direct content display
 */
const ForumMainPage: React.FC = () => {
  return (
    <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-gray-800">
      <Routes>
        {/* Topic list page */}
        <Route index element={<ForumTopicList />} />

        {/* Topic detail page */}
        <Route path=":topicId" element={<ForumTopicDetail />} />
      </Routes>
    </div>
  )
}

export default ForumMainPage