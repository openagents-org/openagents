import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import { useOpenAgents } from "@/context/OpenAgentsProvider";
import { useProfileStore } from "@/stores/profileStore";
import ProjectTemplateDialog from "@/components/project/ProjectTemplateDialog";

interface ProjectSummary {
  project_id: string;
  name: string;
  goal: string;
  template_id: string;
  status: string;
  initiator_agent_id: string;
  created_timestamp: number;
  started_timestamp?: number;
  completed_timestamp?: number;
  summary?: string;
}

/**
 * Project Sidebar Component
 *
 * Displays on the left side of the project page, including:
 * - New Project button at the top
 * - Project list
 */
const ProjectSidebar: React.FC = () => {
  const { t } = useTranslation('project');
  const navigate = useNavigate();
  const location = useLocation();
  const { connector, connectionStatus, isConnected } = useOpenAgents();
  const healthData = useProfileStore((state) => state.healthData);

  // Project list state
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false);

  // New Project dialog state
  const [showProjectDialog, setShowProjectDialog] = useState<boolean>(false);

  // Get currently selected project ID (extract from URL)
  const getCurrentProjectId = (): string | null => {
    const match = location.pathname.match(/^\/project\/([^/]+)/);
    return match ? match[1] : null;
  };

  const currentProjectId = getCurrentProjectId();

  // Load project list
  const loadProjectList = useCallback(async () => {
    if (!connector || !isConnected) return;

    setLoadingProjects(true);
    try {
      const agentId = connectionStatus.agentId || connector.getAgentId();
      const response = await connector.sendEvent({
        event_name: "project.list",
        source_id: agentId,
        destination_id: "mod:openagents.mods.workspace.project",
        payload: {},
      });

      if (response.success && response.data?.projects) {
        // Sort by creation time in descending order (newest first)
        const sortedProjects = [...response.data.projects].sort(
          (a, b) => b.created_timestamp - a.created_timestamp
        );
        setProjectList(sortedProjects);
      } else {
        console.error("Failed to load project list:", response.message);
      }
    } catch (error) {
      console.error("Error loading project list:", error);
    } finally {
      setLoadingProjects(false);
    }
  }, [connector, isConnected, connectionStatus.agentId]);

  // Initial load of project list
  useEffect(() => {
    if (isConnected && connector) {
      loadProjectList();
    }
  }, [isConnected, connector, loadProjectList]);

  // Listen for project notifications and refresh project list
  useEffect(() => {
    if (!isConnected || !connector) return;

    const handleProjectNotifications = (event: any) => {
      if (
        event.event_name === "project.notification.started" ||
        event.event_name === "project.notification.completed" ||
        event.event_name === "project.notification.stopped"
      ) {
        // Refresh project list
        loadProjectList();
      }
    };

    connector.on("rawEvent", handleProjectNotifications);
    return () => {
      connector.off("rawEvent", handleProjectNotifications);
    };
  }, [isConnected, connector, loadProjectList]);

  // Handle project click
  const handleProjectClick = (projectId: string) => {
    navigate(`/project/${projectId}`);
  };

  // Format timestamp display
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return t('sidebar.time.today');
    } else if (days === 1) {
      return t('sidebar.time.yesterday');
    } else if (days < 7) {
      return t('sidebar.time.daysAgo', { count: days });
    } else {
      return date.toLocaleDateString();
    }
  };

  // Get status badge style
  const getStatusBadge = (status: string) => {
    const statusColors: Record<
      string,
      { bg: string; text: string; label: string }
    > = {
      running: {
        bg: "bg-green-100 dark:bg-green-900",
        text: "text-green-800 dark:text-green-200",
        label: t('sidebar.status.running'),
      },
      completed: {
        bg: "bg-blue-100 dark:bg-blue-900",
        text: "text-blue-800 dark:text-blue-200",
        label: t('sidebar.status.completed'),
      },
      created: {
        bg: "bg-gray-100 dark:bg-gray-700",
        text: "text-gray-800 dark:text-gray-200",
        label: t('sidebar.status.created'),
      },
      paused: {
        bg: "bg-yellow-100 dark:bg-yellow-900",
        text: "text-yellow-800 dark:text-yellow-200",
        label: t('sidebar.status.paused'),
      },
      failed: {
        bg: "bg-red-100 dark:bg-red-900",
        text: "text-red-800 dark:text-red-200",
        label: t('sidebar.status.failed'),
      },
      stopped: {
        bg: "bg-gray-100 dark:bg-gray-700",
        text: "text-gray-800 dark:text-gray-200",
        label: t('sidebar.status.stopped'),
      },
    };

    return statusColors[status] || statusColors.created;
  };

  return (
    <>
      <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-800">
        {/* Top: New Project Button */}
        <div className="p-4">
          {/* New Project Button - only shown when project mode is enabled */}
          <button
            onClick={() => setShowProjectDialog(true)}
            className="mb-5 w-full flex items-center justify-center px-4 py-3 rounded-lg text-sm font-medium text-white transition-all bg-gradient-to-r from-purple-600 via-purple-500 to-purple-400 hover:from-purple-700 hover:via-purple-600 hover:to-purple-500 shadow-md hover:shadow-lg mt-2"
          >
            <span>{t('sidebar.newProject')}</span>
          </button>
        </div>

        {/* Project List */}
        <div className="flex-1 overflow-y-auto">
          {loadingProjects ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              {t('sidebar.loading')}
            </div>
          ) : projectList.length === 0 ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              <div className="mb-2">
                <svg
                  className="w-12 h-12 mx-auto mb-2 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                  />
                </svg>
              </div>
              <p className="text-sm">{t('sidebar.noProjects')}</p>
              <p className="text-xs mt-1">
                {t('sidebar.createHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {projectList.map((project) => (
                <div
                  key={project.project_id}
                  onClick={() => handleProjectClick(project.project_id)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${project.project_id === currentProjectId
                    ? "bg-blue-100 dark:bg-blue-900/30 border-l-4 border-blue-500"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800"
                    }`}
                >
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate flex-1">
                      {project.name ||
                        `Project ${project.project_id.slice(0, 8)}`}
                    </h3>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ml-2 flex-shrink-0 ${getStatusBadge(project.status).bg
                        } ${getStatusBadge(project.status).text}`}
                    >
                      {getStatusBadge(project.status).label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mb-1">
                    {project.goal}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {formatTimestamp(project.created_timestamp)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New Project dialog */}
      {showProjectDialog && (
        <ProjectTemplateDialog
          onClose={() => setShowProjectDialog(false)}
          healthData={healthData}
        />
      )}
    </>
  );
};

export default ProjectSidebar;
