import React, { useMemo, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import {
  FeedAttachment,
  FeedCreatePayload,
} from "@/types/feed";
import { useHealthGroups } from "@/hooks/useHealthGroups";
import type { HttpEventConnector } from "@/services/eventConnector";
import { Button } from "@/components/layout/ui/button";

interface FeedCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (payload: FeedCreatePayload) => Promise<boolean>;
  isSubmitting: boolean;
  error?: string | null;
  connector: HttpEventConnector | null;
}

const FeedCreateModal: React.FC<FeedCreateModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  isSubmitting,
  error,
  connector,
}) => {
  const { t } = useTranslation('feed');
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [allowedGroups, setAllowedGroups] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<FeedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showGroupsDropdown, setShowGroupsDropdown] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
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

  const resetForm = () => {
    setTitle("");
    setContent("");
    setTags([]);
    setTagInput("");
    setAllowedGroups([]);
    setAttachments([]);
    setShowPreview(false);
    setShowGroupsDropdown(false);
  };

  const toggleGroupSelection = (group: string) => {
    setAllowedGroups(prev =>
      prev.includes(group)
        ? prev.filter(g => g !== group)
        : [...prev, group]
    );
  };

  const handleAddTag = () => {
    const value = tagInput.trim();
    if (!value || tags.includes(value)) return;
    setTags((prev) => [...prev, value]);
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      handleAddTag();
    }
  };

  const handleAttachmentUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file || !connector) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("agent_id", connector.getAgentId() || "feed-agent");
      formData.append("context", "feed");

      const response = await fetch("/api/workspace/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || "Upload failed");
      }

      const attachment: FeedAttachment = {
        file_id: result.file_id,
        filename: result.filename || file.name,
        size: result.size || file.size,
      };

      setAttachments((prev) => [...prev, attachment]);
    } catch (uploadError) {
      console.error("FeedCreateModal: failed to upload attachment", uploadError);
    } finally {
      setUploading(false);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleRemoveAttachment = (fileId: string) => {
    setAttachments((prev) => prev.filter((item) => item.file_id !== fileId));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !content.trim()) {
      return;
    }
    const payload: FeedCreatePayload = {
      title: title.trim(),
      content: content.trim(),
      tags,
      allowed_groups: allowedGroups.length > 0 ? allowedGroups : undefined,
      attachments,
    };
    const success = await onCreate(payload);
    if (success) {
      resetForm();
      onClose();
    }
  };

  const canSubmit = useMemo(() => {
    return title.trim().length > 0 && content.trim().length > 0 && !uploading;
  }, [title, content, uploading]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="bg-white dark:bg-gray-800 w-full max-w-4xl rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 max-h-[95vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t('createModal.title')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('createModal.subtitle')}
            </p>
          </div>
          <Button
            onClick={() => {
              resetForm();
              onClose();
            }}
            variant="ghost"
            size="sm"
            className="rounded-full"
            aria-label="Close feed modal"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </Button>
        </div>

        <form
          id="feed-create-form"
          className="flex-1 overflow-y-auto px-6 py-4 space-y-6"
          onSubmit={handleSubmit}
        >
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('createModal.postTitle')}
            </label>
            <input
              type="text"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder={t('createModal.postTitlePlaceholder')}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('createModal.titleLength', { current: title.length })}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('createModal.content')}
              </label>
              <Button
                type="button"
                onClick={() => setShowPreview((prev) => !prev)}
                variant="ghost"
                size="sm"
                className="text-xs"
              >
                {showPreview ? "Hide preview" : t('createModal.previewMarkdown')}
              </Button>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full min-h-[200px] rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder={t('createModal.contentPlaceholder')}
            />
            {showPreview && (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-3">
                {content.trim() ? (
                  <MarkdownRenderer content={content} />
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Start typing to see the preview.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('createModal.tags')}
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder={t('createModal.tagsPlaceholder')}
              />
              <Button
                type="button"
                onClick={handleAddTag}
                variant="primary"
                size="sm"
              >
                {t('createModal.addTag')}
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200"
                  >
                    #{tag}
                    <Button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      variant="ghost"
                      size="sm"
                      className="ml-2 h-auto w-auto p-0"
                    >
                      ×
                    </Button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('createModal.allowedGroups')}
            </label>
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowGroupsDropdown(!showGroupsDropdown)}
                disabled={groupsLoading || isSubmitting}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 text-left flex items-center justify-between disabled:opacity-50"
              >
                <span className="flex items-center space-x-2">
                  {allowedGroups.length === 0 ? (
                    <span className="text-gray-500 dark:text-gray-400">
                      {groupsLoading ? 'Loading groups...' : 'Select groups'}
                    </span>
                  ) : (
                    <span className="flex items-center space-x-2">
                      <span>{allowedGroups.length} group(s) selected</span>
                      <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                        {allowedGroups.length}
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
                <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-auto">
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
                            checked={allowedGroups.includes(group)}
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
            {allowedGroups.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {allowedGroups.map((group) => (
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
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('createModal.allowedGroupsHint')}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('createModal.attachments')}
            </label>
            <div className="flex items-center justify-between rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('createModal.uploadFiles')}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('createModal.uploadHint')}
                </p>
              </div>
              <label
                className={`inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg cursor-pointer ${uploading || !connector
                  ? "bg-indigo-300 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-500"
                  }`}
                title={
                  connector ? "Upload attachment" : "Connect to an agent to upload"
                }
              >
                {uploading
                  ? "Uploading..."
                  : connector
                    ? "Select file"
                    : "Connect to upload"}
                <input
                  type="file"
                  className="hidden"
                  onChange={handleAttachmentUpload}
                  disabled={uploading || !connector}
                />
              </label>
            </div>
            {attachments.length > 0 && (
              <div className="space-y-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.file_id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                        {attachment.filename}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {(attachment.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <Button
                      type="button"
                      onClick={() => handleRemoveAttachment(attachment.file_id)}
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-500"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-500/60 bg-red-50 dark:bg-red-950/40 px-4 py-2 text-sm text-red-700 dark:text-red-200">
              {error}
            </div>
          )}
        </form>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {t('createModal.immutableWarning')}
          </div>
          <div className="flex items-center space-x-3">
            <Button
              type="button"
              onClick={() => {
                resetForm();
                onClose();
              }}
              variant="outline"
              size="sm"
            >
              {t('createModal.cancel')}
            </Button>
            <Button
              type="submit"
              form="feed-create-form"
              disabled={!canSubmit || isSubmitting}
              variant="primary"
              size="sm"
            >
              {isSubmitting ? t('createModal.creating') : t('createModal.create')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeedCreateModal;

