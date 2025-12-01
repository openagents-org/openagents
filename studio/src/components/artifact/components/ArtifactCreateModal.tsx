import React, { useState, useRef, useEffect } from 'react';
import { useArtifactStore } from '@/stores/artifactStore';
import { useHealthGroups } from '@/hooks/useHealthGroups';

interface ArtifactCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ArtifactCreateModal: React.FC<ArtifactCreateModalProps> = ({
  isOpen,
  onClose
}) => {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [mimeType, setMimeType] = useState('application/json');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [showGroupsDropdown, setShowGroupsDropdown] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const createArtifact = useArtifactStore(state => state.createArtifact);
  const { groups, isLoading: groupsLoading } = useHealthGroups();

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowGroupsDropdown(false);
      }
    };

    if (showGroupsDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showGroupsDropdown]);

  const handleSubmit = async () => {
    if (!name.trim() || !content.trim()) return;

    setIsSubmitting(true);
    const success = await createArtifact({
      name: name.trim(),
      content: content.trim(),
      mime_type: mimeType,
      allowed_agent_groups: selectedGroups.length > 0 ? selectedGroups : undefined
    });

    if (success) {
      setName('');
      setContent('');
      setMimeType('application/json');
      setSelectedGroups([]);
      onClose();
    }
    setIsSubmitting(false);
  };

  const toggleGroupSelection = (group: string) => {
    setSelectedGroups(prev =>
      prev.includes(group)
        ? prev.filter(g => g !== group)
        : [...prev, group]
    );
  };

  const handleClose = () => {
    setName('');
    setContent('');
    setMimeType('application/json');
    setSelectedGroups([]);
    setShowGroupsDropdown(false);
    onClose();
  };

  if (!isOpen) return null;

  // 常见的MIME类型选项
  const mimeTypeOptions = [
    { value: 'application/json', label: 'JSON' },
    { value: 'text/plain', label: 'Plain Text' },
    { value: 'text/markdown', label: 'Markdown' },
    { value: 'text/html', label: 'HTML' },
    { value: 'application/xml', label: 'XML' },
    { value: 'text/csv', label: 'CSV' },
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* 背景遮罩 */}
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
          onClick={handleClose}
        />

        {/* 模态框 */}
        <div className="absolute inline-block w-full max-w-2xl left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 overflow-hidden text-left align-middle transition-all transform shadow-xl rounded-lg bg-white dark:bg-gray-800">
          {/* 头部 */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                Create New Artifact
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
            {/* 名称输入 */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter artifact name..."
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
              />
            </div>

            {/* MIME类型选择 */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                MIME Type
              </label>
              <select
                value={mimeType}
                onChange={(e) => setMimeType(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
              >
                {mimeTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.value})
                  </option>
                ))}
              </select>
            </div>

            {/* 内容输入 */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Content
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Enter artifact content..."
                rows={12}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 font-mono text-sm"
              />
            </div>

            {/* Permission Groups (Optional) */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Permission Groups (Optional)
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Leave empty to make artifact visible to all users
              </p>

              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowGroupsDropdown(!showGroupsDropdown)}
                  disabled={groupsLoading || isSubmitting}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 text-left flex items-center justify-between disabled:opacity-50"
                >
                  <span className="flex items-center space-x-2">
                    {selectedGroups.length === 0 ? (
                      <span className="text-gray-500 dark:text-gray-400">
                        {groupsLoading ? 'Loading groups...' : 'Select permission groups...'}
                      </span>
                    ) : (
                      <span className="flex items-center space-x-2">
                        <span>{selectedGroups.length} group{selectedGroups.length > 1 ? 's' : ''} selected</span>
                        <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                          {selectedGroups.length}
                        </span>
                      </span>
                    )}
                  </span>
                  <svg
                    className={`w-4 h-4 transition-transform ${showGroupsDropdown ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Dropdown Menu */}
                {showGroupsDropdown && !groupsLoading && (
                  <div className="absolute z-10 w-full bottom-full mb-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-auto">
                    {groups.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        No groups available
                      </div>
                    ) : (
                      <div className="py-1">
                        {groups.map((group) => (
                          <label
                            key={group}
                            className="flex items-center px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedGroups.includes(group)}
                              onChange={() => toggleGroupSelection(group)}
                              disabled={isSubmitting}
                              className="mr-3 rounded border-gray-300 dark:border-gray-500 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                            />
                            <span className="text-sm text-gray-900 dark:text-gray-100">
                              {group}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Selected Groups Display */}
              {selectedGroups.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedGroups.map((group) => (
                    <span
                      key={group}
                      className="inline-flex items-center px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full"
                    >
                      {group}
                      <button
                        type="button"
                        onClick={() => toggleGroupSelection(group)}
                        disabled={isSubmitting}
                        className="ml-1 hover:text-blue-900 dark:hover:text-blue-100 disabled:opacity-50"
                      >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
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
              disabled={!name.trim() || !content.trim() || isSubmitting}
              className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
                !name.trim() || !content.trim() || isSubmitting
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isSubmitting ? 'Creating...' : 'Create Artifact'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArtifactCreateModal;

