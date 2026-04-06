import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Artifact } from '@/stores/artifactStore';
import { formatDateTime } from '@/utils/utils';

interface ArtifactTopicItemProps {
  artifact: Artifact;
}

const ArtifactTopicItem: React.FC<ArtifactTopicItemProps> = React.memo(({
  artifact
}) => {
  const { t } = useTranslation('artifact');
  const navigate = useNavigate();

  const handleClick = () => {
    console.log('ArtifactTopicItem: Navigating to artifact:', artifact.artifact_id, 'URL:', `/artifact/${artifact.artifact_id}`);
    navigate(`/artifact/${artifact.artifact_id}`);
  };

  const timeAgo = artifact.created_at
    ? formatDateTime(artifact.created_at * 1000)
    : 'Unknown';

  // 格式化文件大小
  const formatFileSize = (bytes?: number) => {
    if (!bytes) return t('detail.unknownSize');
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // 根据 MIME 类型获取图标
  const getMimeIcon = (mimeType: string) => {
    if (mimeType.includes('json')) {
      return (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      );
    } else if (mimeType.includes('markdown') || mimeType.includes('text')) {
      return (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    } else {
      return (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    }
  };

  return (
    <div
      onClick={handleClick}
      className="flex flex-col h-full p-5 rounded-xl border cursor-pointer transition-all hover:shadow-xl bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-gray-50 dark:hover:bg-gray-750"
    >
      {/* 图标和 MIME 类型 */}
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
          {getMimeIcon(artifact.mime_type)}
        </div>
        <span className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full font-medium">
          {artifact.mime_type.split('/')[1]?.toUpperCase() || artifact.mime_type}
        </span>
      </div>

      {/* Artifact名称 */}
      <h3 className="text-lg font-semibold mb-3 line-clamp-2 text-gray-900 dark:text-gray-100 min-h-[3.5rem]">
        {artifact.name}
      </h3>

      {/* 文件大小和创建者 */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-3 mt-auto">
        {artifact.file_size && (
          <div className="flex items-center space-x-1">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
            <span>{formatFileSize(artifact.file_size)}</span>
          </div>
        )}
        {artifact.created_by && (
          <div className="text-right">
            <div className="font-medium text-gray-700 dark:text-gray-300">{artifact.created_by}</div>
            <div className="text-gray-500 dark:text-gray-500">{timeAgo}</div>
          </div>
        )}
      </div>

      {/* 权限组标签 */}
      {artifact.allowed_agent_groups && artifact.allowed_agent_groups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-gray-200 dark:border-gray-700">
          {artifact.allowed_agent_groups.slice(0, 2).map((group) => (
            <span
              key={group}
              className="inline-flex items-center px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full"
            >
              {group}
            </span>
          ))}
          {artifact.allowed_agent_groups.length > 2 && (
            <span className="inline-flex items-center px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full">
              +{artifact.allowed_agent_groups.length - 2}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

ArtifactTopicItem.displayName = 'ArtifactTopicItem';

export default ArtifactTopicItem;

