import React, { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useIsAdmin } from "@/hooks/useIsAdmin"
import { useProfileStore } from "@/stores/profileStore"
import { isProjectModeEnabled } from "@/utils/projectUtils"
import ProjectTemplateDialog from "@/components/project/ProjectTemplateDialog"

const ProfileSidebar: React.FC = () => {
  const { t } = useTranslation("profile")
  const { isLoading } = useIsAdmin()
  const healthData = useProfileStore((state) => state.healthData)
  const [showProjectDialog, setShowProjectDialog] = useState(false)

  // Check if project mode is enabled
  const projectModeEnabled = useMemo(
    () => isProjectModeEnabled(healthData),
    [healthData]
  )


  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
        {/* New Project Button - only shown when project mode is enabled */}
        {projectModeEnabled && (
          <button
            onClick={() => setShowProjectDialog(true)}
            className="mb-5 w-full flex items-center justify-center px-4 py-3 rounded-lg text-sm font-medium text-white transition-all bg-gradient-to-r from-purple-600 via-purple-500 to-purple-400 hover:from-purple-700 hover:via-purple-600 hover:to-purple-500 shadow-md hover:shadow-lg mt-2"
          >
            <span>{t("profile.sidebar.newProject")}</span>
          </button>
        )}
      </div>

      {/* Project Template Selection Dialog */}
      {showProjectDialog && (
        <ProjectTemplateDialog
          onClose={() => setShowProjectDialog(false)}
          healthData={healthData}
        />
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-center py-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
              {t("profile.sidebar.checkingPermissions")}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProfileSidebar
