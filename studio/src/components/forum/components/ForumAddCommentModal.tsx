import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';

interface ForumAddCommentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (content: string) => Promise<boolean>;
  isSubmitting: boolean;
}

const ForumAddCommentModal: React.FC<ForumAddCommentModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting
}) => {
  const { t } = useTranslation('forum');
  const [content, setContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const handleSubmit = async () => {
    if (!content.trim()) return;

    const success = await onSubmit(content.trim());

    if (success) {
      setContent('');
      setShowPreview(false);
      onClose();
    }
  };

  const handleClose = () => {
    setContent('');
    setShowPreview(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
          onClick={handleClose}
        />

        {/* Modal */}
        <div className="absolute inline-block w-full max-w-2xl left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 overflow-hidden text-left align-middle transition-all transform shadow-xl rounded-lg bg-white dark:bg-gray-800">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {t('commentModal.title')}
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

          {/* Content */}
          <div className="px-6 py-4 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('commentModal.content')}
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
                  {showPreview ? t('commentModal.edit') : t('commentModal.preview')}
                </button>
              </div>

              {showPreview ? (
                <div className="w-full p-3 border rounded-md min-h-[200px] bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                  {content.trim() ? (
                    <MarkdownRenderer content={content} />
                  ) : (
                    <p className="text-gray-400 dark:text-gray-500">
                      {t('commentModal.previewPlaceholder')}
                    </p>
                  )}
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t('commentModal.contentPlaceholder')}
                  rows={8}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                />
              )}
            </div>
          </div>

          {/* Footer buttons */}
          <div className="px-6 py-4 border-t flex justify-end space-x-3 border-gray-200 dark:border-gray-700">
            <button
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium rounded-md transition-colors bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              {t('commentModal.cancel')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!content.trim() || isSubmitting}
              className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
                !content.trim() || isSubmitting
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isSubmitting ? t('commentModal.posting') : t('commentModal.submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForumAddCommentModal;
