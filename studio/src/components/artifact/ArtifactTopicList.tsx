import React, { useEffect, useContext } from "react";
import { useArtifactStore } from "@/stores/artifactStore";
import ArtifactTopicItem from "./components/ArtifactTopicItem";
import ArtifactPagination from "./components/ArtifactPagination";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";

const ArtifactTopicList: React.FC = () => {
  const context = useContext(OpenAgentsContext);
  const openAgentsService = context?.connector;
  const isConnected = context?.isConnected;

  const {
    artifacts,
    artifactsLoading,
    artifactsError,
    currentPage,
    totalItems,
    itemsPerPage,
    setConnection,
    setGroupsData,
    setAgentId,
    loadArtifacts,
    setCurrentPage,
    getPaginatedArtifacts,
    getTotalPages,
  } = useArtifactStore();

  // 设置连接
  useEffect(() => {
    if (openAgentsService) {
      setConnection(openAgentsService);
    }
  }, [openAgentsService, setConnection]);

  // 初始化权限数据
  useEffect(() => {
    const initializePermissions = async () => {
      if (!openAgentsService) return;

      try {
        // 获取当前agent ID
        const agentId = openAgentsService.getAgentId();
        if (agentId) {
          console.log("ArtifactTopicList: Setting agentId:", agentId);
          setAgentId(agentId);
        }

        // 获取groups数据
        const healthData = await openAgentsService.getNetworkHealth();
        if (healthData && healthData.groups) {
          console.log("ArtifactTopicList: Setting groupsData:", healthData.groups);
          setGroupsData(healthData.groups);
        }
      } catch (error) {
        console.error("ArtifactTopicList: Failed to initialize permissions:", error);
      }
    };

    initializePermissions();
  }, [openAgentsService, setGroupsData, setAgentId]);

  // 加载artifacts（等待连接建立）
  useEffect(() => {
    if (openAgentsService && isConnected) {
      console.log("ArtifactTopicList: Connection ready, loading artifacts");
      loadArtifacts();
    }
  }, [openAgentsService, isConnected, loadArtifacts]);

  if (artifactsLoading && artifacts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading artifacts...</p>
        </div>
      </div>
    );
  }

  if (artifactsError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className={`text-red-500 mb-4`}>
            <svg
              className="w-12 h-12 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="mb-4 text-gray-700 dark:text-gray-300">{artifactsError}</p>
          <button
            onClick={() => loadArtifacts()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full ">
      {/* 头部 */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between   bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Artifacts
          </h1>
          <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">
            {totalItems} artifacts available
          </p>
        </div>

        {/* New Artifact button moved to sidebar */}
      </div>

      {/* Artifact列表 */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
        {totalItems === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12">
            <div className="mb-4 text-gray-500 dark:text-gray-400">
              <svg
                className="w-16 h-16 mx-auto"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium mb-2 text-gray-700 dark:text-gray-300">
              No artifacts yet
            </h3>
            <p className="mb-4 text-gray-600 dark:text-gray-400">
              Create your first artifact using the "New Artifact" button in the sidebar!
            </p>
          </div>
        ) : (
          <>
            {/* Artifacts Grid */}
            <div className="flex-1 px-6 py-6 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {getPaginatedArtifacts().map((artifact) => (
                  <ArtifactTopicItem key={artifact.artifact_id} artifact={artifact} />
                ))}
              </div>
            </div>

            {/* Pagination - Fixed at bottom right */}
            <ArtifactPagination
              currentPage={currentPage}
              totalPages={getTotalPages()}
              totalItems={totalItems}
              itemsPerPage={itemsPerPage}
              onPageChange={setCurrentPage}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default ArtifactTopicList;

