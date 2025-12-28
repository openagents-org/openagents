import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useWikiStore } from '@/stores/wikiStore';
import { toast } from "sonner";
import WikiEditor from './WikiEditor';

interface WikiCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WikiCreateModal: React.FC<WikiCreateModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation('wiki');
  const [pagePath, setPagePath] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const { createPage } = useWikiStore();

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setPagePath('');
      setTitle('');
      setContent('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pagePath.trim() || !title.trim() || !content.trim()) return;

    const success = await createPage(pagePath, title, content);
    if (success) {
      onClose();
    } else {
      // Show error toast
      toast.error(t('createModal.errors.createFailed'));
    }
  };

  const handleClose = () => {
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="w-full max-w-4xl max-h-[90vh] mx-4 flex flex-col rounded-lg bg-white dark:bg-gray-800">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              {t('createModal.title')}
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
        <div className="flex-1 px-6 py-4 overflow-y-auto min-h-0">
          <form id="wiki-form" onSubmit={handleSubmit} className="h-full flex flex-col space-y-4">
            <div className="flex-shrink-0">
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                {t('createModal.pagePath')}
              </label>
              <input
                type="text"
                value={pagePath}
                onChange={(e) => setPagePath(e.target.value)}
                placeholder={t('createModal.pagePathPlaceholder')}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
                required
              />
            </div>

            <div className="flex-shrink-0">
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                {t('createModal.pageTitle')}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('createModal.pageTitlePlaceholder')}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
                required
              />
            </div>

            <div className="flex-1 flex flex-col min-h-[300px]">
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300 flex-shrink-0">
                {t('createModal.content')}
              </label>
              <WikiEditor
                value={content}
                onChange={setContent}
                modes={['edit', 'preview']}
                style={{ flex: 1, minHeight: '250px' }}
                placeholder={t('createModal.contentPlaceholder')}
                textareaProps={{ required: true }}
              />
            </div>
          </form>
        </div>

        {/* Bottom buttons */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3 flex-shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-lg transition-colors text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            {t('createModal.cancel')}
          </button>
          <button
            type="submit"
            form="wiki-form"
            disabled={!pagePath.trim() || !title.trim() || !content.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('createModal.create')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WikiCreateModal;