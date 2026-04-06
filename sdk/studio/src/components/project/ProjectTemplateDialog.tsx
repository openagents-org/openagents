import React, { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { HealthResponse } from "@/utils/moduleUtils"
import { ProjectTemplate } from "@/utils/projectUtils"
import { useOpenAgents } from "@/context/OpenAgentsProvider"
import { toast } from "sonner"

interface ProjectTemplateDialogProps {
  onClose: () => void
  healthData: HealthResponse | null
}

const ProjectTemplateDialog: React.FC<ProjectTemplateDialogProps> = ({
  onClose,
  healthData,
}) => {
  const { t } = useTranslation('project')
  const navigate = useNavigate()
  const { connector, connectionStatus } = useOpenAgents()
  const [selectedTemplate, setSelectedTemplate] =
    useState<ProjectTemplate | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [templates, setTemplates] = useState<ProjectTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)

  // Load templates using project.template.list event
  useEffect(() => {
    const loadTemplates = async () => {
      if (!connector) return

      setLoadingTemplates(true)
      try {
        const agentId = connectionStatus.agentId || connector.getAgentId()
        console.log("Loading templates", {
          event_name: "project.template.list",
          source_id: agentId,
          destination_id: "mod:openagents.mods.workspace.project",
          payload: {},
        })
        const response = await connector.sendEvent({
          event_name: "project.template.list",
          source_id: agentId,
          destination_id: "mod:openagents.mods.workspace.project",
          payload: {},
        })

        if (response.success && response.data?.templates) {
          setTemplates(response.data.templates)
        } else {
          console.error("Failed to load templates:", response.message)
          // Fallback to health data if API fails
          const fallbackTemplates = getProjectTemplatesFromHealth(healthData)
          setTemplates(fallbackTemplates)
        }
      } catch (error) {
        console.error("Error loading templates:", error)
        // Fallback to health data
        const fallbackTemplates = getProjectTemplatesFromHealth(healthData)
        setTemplates(fallbackTemplates)
      } finally {
        setLoadingTemplates(false)
      }
    }

    loadTemplates()
  }, [connector, connectionStatus.agentId, healthData])

  // Fallback function to get templates from health data
  const getProjectTemplatesFromHealth = (
    healthData: HealthResponse | null
  ): ProjectTemplate[] => {
    if (!healthData?.data?.mods) {
      return []
    }

    const projectMod = healthData.data.mods.find(
      (mod) => mod.name === "openagents.mods.workspace.project" && mod.enabled
    )

    if (!projectMod?.config?.project_templates) {
      return []
    }

    const templates = projectMod.config.project_templates
    return Object.entries(templates).map(
      ([templateId, templateData]: [string, any]) => ({
        template_id: templateId,
        name: templateData.name || templateId,
        description: templateData.description || "",
        agent_groups: templateData.agent_groups || [],
        context: templateData.context || "",
      })
    )
  }

  const handleTemplateSelect = (template: ProjectTemplate) => {
    setSelectedTemplate(template)
  }

  const handleCreateProject = async () => {
    if (!selectedTemplate || !connector) {
      toast.error(t('template.messages.selectRequired'))
      return
    }

    setIsCreating(true)

    try {
      // Don't send project.start yet - wait for first message
      // Navigate to project chat room with template info in route state
      // The first message will trigger project.start with that message as the goal

      // Close the dialog first
      onClose()

      // Navigate to project chat room with pending template info
      // Using "new" as projectId to indicate pending project
      navigate(`/project/new`, {
        state: {
          pendingTemplate: selectedTemplate,
        },
      })

      toast.info(t('template.messages.selected'))
    } catch (error: any) {
      console.error("Failed to prepare project:", error)
      toast.error(
        t('template.messages.prepareError', { error: error.message || "Unknown error" })
      )
    } finally {
      setIsCreating(false)
    }
  }

  if (loadingTemplates) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
          <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-gray-100">
            {t('template.title')}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {t('template.loading')}
          </p>
        </div>
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
          <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-gray-100">
            {t('template.title')}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {t('template.empty.message')}
          </p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            {t('template.empty.close')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 shadow-xl max-h-[86vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-gray-100">
          {t('template.title')}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {t('template.description')}
        </p>

        <div className="space-y-3 mb-6">
          {templates.map((template) => (
            <div
              key={template.template_id}
              onClick={() => handleTemplateSelect(template)}
              className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${selectedTemplate?.template_id === template.template_id
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">
                    {template.name}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    {template.description}
                  </p>
                  {template.agent_groups.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {template.agent_groups.map((group) => (
                        <span
                          key={group}
                          className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded"
                        >
                          {group}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {selectedTemplate?.template_id === template.template_id && (
                  <div className="ml-4 text-blue-500 text-2xl">✓</div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isCreating}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('template.actions.cancel')}
          </button>
          <button
            onClick={handleCreateProject}
            disabled={!selectedTemplate || isCreating}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? t('template.actions.creating') : t('template.actions.create')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProjectTemplateDialog
