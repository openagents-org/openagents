import React, { useState } from 'react';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import { useForumStore } from '@/stores/forumStore';

interface ForumCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ForumCreateModal: React.FC<ForumCreateModalProps> = ({
  isOpen,
  onClose
}) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createTopic = useForumStore(state => state.createTopic);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) return;

    setIsSubmitting(true);
    const success = await createTopic({
      title: title.trim(),
      content: content.trim()
    });

    if (success) {
      setTitle('');
      setContent('');
      setShowPreview(false);
      onClose();
    }
    setIsSubmitting(false);
  };

  const handleClose = () => {
    setTitle('');
    setContent('');
    setShowPreview(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* 背景遮罩 */}
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
        />

        {/* 模态框 */}
        <div className="absolute inline-block w-full max-w-2xl left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 overflow-hidden text-left align-middle transition-all transform shadow-xl rounded-lg bg-white dark:bg-gray-800">
          {/* 头部 */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                Create New Topic
              </h3>
              <button
                onClick={handleClose}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* 内容 */}
          <div className="px-6 py-4 space-y-4">
            {/* 标题输入 */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter topic title..."
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
              />
            </div>

            {/* 内容输入 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Content (Markdown supported)
                </label>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className={`text-xs px-3 py-1 rounded transition-colors ${
                    showPreview
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {showPreview ? 'Edit' : 'Preview'}
                </button>
              </div>

              {showPreview ? (
                <div className="w-full p-3 border rounded-md min-h-[200px] bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                  {content.trim() ? (
                    <MarkdownRenderer
                      content={content}
                    />
                  ) : (
                    <p className="text-gray-400 dark:text-gray-500">
                      Preview will appear here...
                    </p>
                  )}
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Enter topic content... (Markdown supported)"
                  rows={8}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                />
              )}
            </div>
          </div>

          {/* 底部按钮 */}
          <div className="px-6 py-4 border-t flex justify-end space-x-3 border-gray-200 dark:border-gray-700">
            <button
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium rounded-md transition-colors bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!title.trim() || !content.trim() || isSubmitting}
              className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
                !title.trim() || !content.trim() || isSubmitting
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isSubmitting ? 'Creating...' : 'Create Topic'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForumCreateModal;