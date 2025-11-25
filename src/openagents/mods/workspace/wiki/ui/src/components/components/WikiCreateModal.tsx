import React, { useState, useEffect } from 'react';
import { useWikiStore } from '../../stores/wikiStore';
import WikiEditor from './WikiEditor';

interface WikiCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WikiCreateModal: React.FC<WikiCreateModalProps> = ({ isOpen, onClose }) => {
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
    }
  };

  const handleClose = () => {
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="w-full max-w-4xl h-5/6 mx-4 flex flex-col rounded-lg bg-white dark:bg-gray-800">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              Create New Wiki Page
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
        <div className="flex-1 px-6 py-4 overflow-hidden">
          <form id="wiki-form" onSubmit={handleSubmit} className="flex-1 flex flex-col space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Page Path
              </label>
              <input
                type="text"
                value={pagePath}
                onChange={(e) => setPagePath(e.target.value)}
                placeholder="Page path (e.g., /getting-started)"
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Page Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Page title..."
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
                required
              />
            </div>

            <div className="flex-1 flex flex-col">
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Content
              </label>
              <WikiEditor
                value={content}
                onChange={setContent}
                modes={['edit', 'preview']}
                style={{ minHeight: '200px', maxHeight: '200px' }}
                placeholder="Enter page content in Markdown format..."
                textareaProps={{ required: true }}
              />
            </div>
          </form>
        </div>

        {/* Bottom buttons */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-lg transition-colors text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="wiki-form"
            disabled={!pagePath.trim() || !title.trim() || !content.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Create Page
          </button>
        </div>
      </div>
    </div>
  );
};

export default WikiCreateModal;

