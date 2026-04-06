import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useArtifactStore } from "@/stores/artifactStore";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";

const ArtifactTopicDetail: React.FC = () => {
  const { t } = useTranslation('artifact');
  const context = useContext(OpenAgentsContext);
  const { artifactId } = useParams<{ artifactId: string }>();
  const navigate = useNavigate();

  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const openAgentsService = context?.connector;
  const isConnected = context?.isConnected;

  const {
    selectedArtifact,
    artifactLoading,
    artifactError,
    setConnection,
    loadArtifact,
    updateArtifact,
    deleteArtifact,
    resetSelectedArtifact,
  } = useArtifactStore();

  // 设置连接
  useEffect(() => {
    if (openAgentsService) {
      console.log("ArtifactTopicDetail: Setting connection");
      setConnection(openAgentsService);
    }
  }, [openAgentsService, setConnection]);

  // 加载artifact详情（等待连接建立）
  useEffect(() => {
    if (artifactId && openAgentsService && isConnected) {
      console.log(
        "ArtifactTopicDetail: Connection ready, loading artifact detail for:",
        artifactId
      );
      loadArtifact(artifactId);
    } else {
      console.log(
        "ArtifactTopicDetail: Waiting for connection or missing artifactId",
        {
          artifactId,
          hasService: !!openAgentsService,
          isConnected,
        }
      );
    }
  }, [artifactId, openAgentsService, isConnected, loadArtifact]);

  // 当artifact加载后，设置编辑内容
  useEffect(() => {
    if (selectedArtifact && !isEditing) {
      setEditedContent(selectedArtifact.content);
    }
  }, [selectedArtifact, isEditing]);

  // 组件卸载时重置选中artifact
  useEffect(() => {
    return () => {
      console.log("ArtifactTopicDetail: Cleanup - resetting selected artifact");
      resetSelectedArtifact();
    };
  }, [resetSelectedArtifact]);

  const handleBack = () => {
    navigate("/artifact");
  };

  const handleEdit = () => {
    if (selectedArtifact) {
      setEditedContent(selectedArtifact.content);
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    if (selectedArtifact) {
      setEditedContent(selectedArtifact.content);
      setIsEditing(false);
    }
  };

  const handleSave = async () => {
    if (!selectedArtifact || !editedContent.trim()) return;

    setIsSubmitting(true);
    const success = await updateArtifact(selectedArtifact.artifact_id, editedContent.trim());
    setIsSubmitting(false);

    if (success) {
      setIsEditing(false);
      toast.success(t('detail.updateSuccess'));
    } else {
      toast.error(t('detail.updateFailed'));
    }
  };

  const handleDelete = async () => {
    if (!selectedArtifact) return;

    if (window.confirm(t('detail.deleteConfirm', { name: selectedArtifact.name }))) {
      const success = await deleteArtifact(selectedArtifact.artifact_id);
      if (success) {
        toast.success(t('detail.deleteSuccess'));
        navigate("/artifact");
      } else {
        toast.error(t('detail.deleteFailed'));
      }
    }
  };

  // 显示连接等待状态
  if (!openAgentsService || !isConnected) {
    return (
      <div className="flex-1 flex items-center justify-center dark:bg-gray-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">
            {!openAgentsService
              ? t('detail.connecting')
              : t('detail.establishing')}
          </p>
        </div>
      </div>
    );
  }

  // 显示加载状态
  if (artifactLoading && !selectedArtifact) {
    return (
      <div className="flex-1 flex items-center justify-center dark:bg-gray-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">{t('detail.loading')}</p>
        </div>
      </div>
    );
  }

  // 显示错误状态
  if (artifactError || !selectedArtifact) {
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
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            {artifactError || t('detail.notFound')}
          </p>
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            {t('detail.backToList')}
          </button>
        </div>
      </div>
    );
  }

  const timeAgo = selectedArtifact.created_at
    ? new Date(selectedArtifact.created_at * 1000).toLocaleString()
    : "Unknown";

  // 格式化文件大小
  const formatFileSize = (bytes?: number) => {
    if (!bytes) return t('detail.unknownSize');
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // 渲染内容（根据MIME类型）
  const renderContent = () => {
    if (isEditing) {
      return (
        <textarea
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          className="w-full px-4 py-3 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 font-mono text-sm"
          rows={20}
        />
      );
    }

    // 根据MIME类型渲染内容
    if (selectedArtifact.mime_type === "application/json") {
      try {
        const jsonContent = JSON.parse(selectedArtifact.content);
        return (
          <pre className="p-4 bg-gray-50 dark:bg-gray-800 rounded-md overflow-x-auto">
            <code className="text-sm text-gray-900 dark:text-gray-100">
              {JSON.stringify(jsonContent, null, 2)}
            </code>
          </pre>
        );
      } catch (e) {
        return (
          <pre className="p-4 bg-gray-50 dark:bg-gray-800 rounded-md overflow-x-auto">
            <code className="text-sm text-gray-900 dark:text-gray-100">
              {selectedArtifact.content}
            </code>
          </pre>
        );
      }
    } else if (selectedArtifact.mime_type.startsWith("text/")) {
      return (
        <pre className="p-4 bg-gray-50 dark:bg-gray-800 rounded-md overflow-x-auto whitespace-pre-wrap">
          <code className="text-sm text-gray-900 dark:text-gray-100">
            {selectedArtifact.content}
          </code>
        </pre>
      );
    } else {
      return (
        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-md">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('detail.previewNotAvailable', { type: selectedArtifact.mime_type })}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
            {t('detail.fileSize', { size: formatFileSize(selectedArtifact.file_size) })}
          </p>
        </div>
      );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* 头部导航 */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <button
          onClick={handleBack}
          className="flex items-center space-x-2 text-sm transition-colors text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          <span>{t('detail.backToList')}</span>
        </button>

        <div className="flex items-center space-x-2">
          {!isEditing ? (
            <>
              <button
                onClick={handleEdit}
                className="px-4 py-2 text-sm font-medium rounded-md transition-colors bg-blue-600 text-white hover:bg-blue-700"
              >
                {t('detail.edit')}
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium rounded-md transition-colors bg-red-600 text-white hover:bg-red-700"
              >
                {t('detail.delete')}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleCancelEdit}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium rounded-md transition-colors bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                {t('detail.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={isSubmitting || !editedContent.trim()}
                className="px-4 py-2 text-sm font-medium rounded-md transition-colors bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isSubmitting ? t('detail.saving') : t('detail.save')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 主要内容 */}
      <div className="flex-1 flex flex-col overflow-hidden dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <div className="flex-1 flex flex-col overflow-y-auto">
          {/* Artifact内容 */}
          <div className="p-6 border-b bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            {/* Artifact名称 */}
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              {selectedArtifact.name}
            </h1>

            {/* Artifact元信息 */}
            <div className="flex items-center justify-between mb-4 text-sm text-gray-600 dark:text-gray-400">
              <div className="flex items-center space-x-4">
                <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs">
                  {selectedArtifact.mime_type}
                </span>
                {selectedArtifact.file_size && (
                  <span>{formatFileSize(selectedArtifact.file_size)}</span>
                )}
              </div>
              <span>
                {selectedArtifact.created_by && `${t('detail.by', { author: selectedArtifact.created_by })} • `}
                {timeAgo}
              </span>
            </div>

            {/* 权限组标签 */}
            {selectedArtifact.allowed_agent_groups &&
              selectedArtifact.allowed_agent_groups.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {selectedArtifact.allowed_agent_groups.map((group) => (
                    <span
                      key={group}
                      className="inline-flex items-center px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full"
                    >
                      {group}
                    </span>
                  ))}
                </div>
              )}

            {/* Artifact内容 */}
            <div className="mb-4">{renderContent()}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArtifactTopicDetail;

