import React from "react"
import { useTranslation } from "react-i18next"

// Default Sidebar Props
export interface DefaultSidebarProps {
  message?: string
  icon?: React.ReactNode
}

// Default Sidebar Content Component - for routes without specific sidebar content
const DefaultSidebar: React.FC<DefaultSidebarProps> = ({ message, icon }) => {
  const { t } = useTranslation("layout")
  const defaultMessage = message || t("defaultSidebar.navigation")
  return (
    <div className="flex-1 flex flex-col justify-center items-center overflow-hidden">
      <div className="flex-1 flex items-center justify-center px-4 py-3">
        <div className="flex items-center justify-center text-center text-gray-400 dark:text-gray-500">
          {/* {icon && <div className="mb-3">{icon}</div>} */}
          <p className="text-sm">{defaultMessage}</p>
        </div>
      </div>
    </div>
  )
}

export default React.memo(DefaultSidebar)
