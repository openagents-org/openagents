import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ForumTopic } from '@/stores/forumStore';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import { formatDateTime } from '@/utils/utils';

interface ForumTopicItemProps {
  topic: ForumTopic;
}

const ForumTopicItem: React.FC<ForumTopicItemProps> = React.memo(({
  topic
}) => {
  const navigate = useNavigate();

  const handleClick = () => {
    console.log('ForumTopicItem: Navigating to topic:', topic.topic_id, 'URL:', `/forum/${topic.topic_id}`);
    navigate(`/forum/${topic.topic_id}`);
  };

  const timeAgo = formatDateTime(topic.timestamp * 1000);

  return (
    <div
      onClick={handleClick}
      className="p-4 rounded-lg border cursor-pointer transition-all hover:shadow-lg bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 hover:border-gray-300 dark:hover:border-gray-600"
    >
      {/* 话题标题 */}
      <h3 className="text-lg font-semibold mb-2 line-clamp-2 text-gray-900 dark:text-gray-100">
        {topic.title}
      </h3>

      {/* 话题内容预览 */}
      <div className="text-sm line-clamp-3">
        <MarkdownRenderer
          content={topic.content}
          truncate={true}
          maxLength={200}
          className="text-gray-600 dark:text-gray-400"
        />
      </div>

      {/* 元信息栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {/* 投票数 */}
          <div className="flex items-center space-x-1">
            <svg
              className="w-4 h-4 text-yellow-500 dark:text-yellow-400"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {topic.upvotes - topic.downvotes}
            </span>
          </div>

          {/* 评论数 */}
          <div className="flex items-center space-x-1">
            <svg
              className="w-4 h-4 text-gray-500 dark:text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {topic.comment_count}
            </span>
          </div>
        </div>

        {/* 作者和时间 */}
        <div className="text-xs text-gray-400 dark:text-gray-500">
          by {topic.owner_id} • {timeAgo}
        </div>
      </div>
    </div>
  );
});

ForumTopicItem.displayName = 'ForumTopicItem';

export default ForumTopicItem;