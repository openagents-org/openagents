import React from "react"
import { Routes, Route } from "react-router-dom"
import WikiPageList from "@/components/wiki/WikiPageList"
import WikiPageDetail from "@/components/wiki/WikiPageDetail"
import WikiProposals from "@/components/wiki/WikiProposals"

/**
 * Wiki main page - handles all Wiki-related features
 * Simplified layout with direct content display
 */
const WikiMainPage: React.FC = () => {
  return (
    <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-gray-800">
      <Routes>
        {/* Default Wiki list view */}
        <Route index element={<WikiPageList />} />

        {/* Wiki page detail */}
        <Route path="detail/:pagePath" element={<WikiPageDetail />} />

        {/* Wiki proposals management */}
        <Route path="proposals" element={<WikiProposals />} />
      </Routes>
    </div>
  )
}

export default WikiMainPage