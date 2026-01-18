import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import { useForumStore } from '@/stores/forumStore';
import { useHealthGroups } from '@/hooks/useHealthGroups';
import { Label } from '@/components/layout/ui/label';
import { Input, InputGroup, InputAddon } from '@/components/layout/ui/input';
import { Button } from '@/components/layout/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from '@/components/layout/ui/dialog';
import { Type, FileText } from 'lucide-react';

interface ForumCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ForumCreateModal: React.FC<ForumCreateModalProps> = ({
  isOpen,
  onClose
}) => {
  const { t } = useTranslation('forum');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [showGroupsDropdown, setShowGroupsDropdown] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const createTopic = useForumStore(state => state.createTopic);
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
    if (!title.trim() || !content.trim()) return;

    setIsSubmitting(true);
    const success = await createTopic({
      title: title.trim(),
      content: content.trim(),
      allowed_groups: selectedGroups.length > 0 ? selectedGroups : undefined
    });

    if (success) {
      setTitle('');
      setContent('');
      setShowPreview(false);
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
    setTitle('');
    setContent('');
    setShowPreview(false);
    setSelectedGroups([]);
    setShowGroupsDropdown(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('createModal.title')}</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-4">
            {/* Title input */}
            <div className="space-y-2">
              <Label htmlFor="topicTitle">
                {t('createModal.topicTitle')}
              </Label>
              <InputGroup>
                <InputAddon mode="icon">
                  <Type size={16} />
                </InputAddon>
                <Input
                  id="topicTitle"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('createModal.topicTitlePlaceholder')}
                />
              </InputGroup>
            </div>

            {/* Content input */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="topicContent">
                  {t('createModal.content')}
                </Label>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className={`text-xs px-3 py-1 rounded transition-colors ${showPreview
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                >
                  {showPreview ? t('createModal.edit') : t('createModal.preview')}
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
                      {t('createModal.previewPlaceholder')}
                    </p>
                  )}
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t('createModal.contentPlaceholder')}
                  rows={8}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                />
              )}
            </div>

            {/* Permission Groups (Optional) */}
            <div className="space-y-2">
              <Label>
                {t('createModal.permissionGroups')}
              </Label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('createModal.permissionGroupsHint')}
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
                        {groupsLoading ? t('createModal.loadingGroups') : t('createModal.selectPermissionGroups')}
                      </span>
                    ) : (
                      <span className="flex items-center space-x-2">
                        <span>
                          {selectedGroups.length === 1
                            ? t('createModal.groupsSelected', { count: selectedGroups.length })
                            : t('createModal.groupsSelectedPlural', { count: selectedGroups.length })}
                        </span>
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
                        {t('createModal.noGroupsAvailable')}
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
        </DialogBody>

        <DialogFooter>
          <Button
            onClick={handleClose}
            disabled={isSubmitting}
            variant="outline"
          >
            {t('createModal.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || !content.trim() || isSubmitting}
            variant="primary"
          >
            {isSubmitting ? t('createModal.creating') : t('createModal.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ForumCreateModal;