import React, { useMemo, useState } from "react";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import {
  FEED_CATEGORY_OPTIONS,
  FeedAttachment,
  FeedCreatePayload,
} from "@/types/feed";
import { useHealthGroups } from "@/hooks/useHealthGroups";
import type { HttpEventConnector } from "@/services/eventConnector";

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
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState<string>("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [allowedGroups, setAllowedGroups] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<FeedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const { groups, isLoading: groupsLoading } = useHealthGroups();

  const resetForm = () => {
    setTitle("");
    setContent("");
    setSummary("");
    setCategory("");
    setTags([]);
    setTagInput("");
    setAllowedGroups([]);
    setAttachments([]);
    setShowPreview(false);
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
      summary: summary.trim() || undefined,
      category: category ? (category as any) : undefined,
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
      <div className="bg-white dark:bg-gray-900 w-full max-w-4xl rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 max-h-[95vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Publish a Feed Update
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Posts are immutable after publishing. Double-check your content.
            </p>
          </div>
          <button
            onClick={() => {
              resetForm();
              onClose();
            }}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
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
          </button>
        </div>

        <form
          id="feed-create-form"
          className="flex-1 overflow-y-auto px-6 py-4 space-y-6"
          onSubmit={handleSubmit}
        >
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Title
            </label>
            <input
              type="text"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Concise summary (max 200 characters)"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {title.length}/200 characters
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">Optional</option>
                {FEED_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Summary (optional)
              </label>
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Short TL;DR for list view"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Content
              </label>
              <button
                type="button"
                onClick={() => setShowPreview((prev) => !prev)}
                className="text-xs font-medium text-blue-600 hover:text-blue-500"
              >
                {showPreview ? "Hide preview" : "Preview Markdown"}
              </button>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full min-h-[200px] rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Supports Markdown for formatting, lists, attachments references, etc."
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
              Tags
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Press Enter to add tag"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500"
              >
                Add
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200"
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-2 text-blue-500 hover:text-blue-700"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Allowed agent groups (optional)
            </label>
            {groupsLoading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Loading groups...
              </p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No groups available from network health.
              </p>
            ) : (
              <select
                multiple
                value={allowedGroups}
                onChange={(e) =>
                  setAllowedGroups(
                    Array.from(e.target.selectedOptions).map(
                      (option) => option.value
                    )
                  )
                }
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none h-32"
              >
                {groups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Leave empty to make the post visible to everyone on this network.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Attachments
            </label>
            <div className="flex items-center justify-between rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Upload files or images
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Attach supporting materials (max 1 file per upload)
                </p>
              </div>
              <label
                className={`inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg cursor-pointer ${
                  uploading || !connector
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
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(attachment.file_id)}
                      className="text-sm text-red-600 hover:text-red-500"
                    >
                      Remove
                    </button>
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

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Posts cannot be edited or deleted once published.
          </div>
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => {
                resetForm();
                onClose();
              }}
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="feed-create-form"
              disabled={!canSubmit || isSubmitting}
              className={`px-4 py-2 rounded-lg text-white ${
                canSubmit
                  ? "bg-blue-600 hover:bg-blue-500"
                  : "bg-blue-300 cursor-not-allowed"
              }`}
            >
              {isSubmitting ? "Publishing..." : "Publish"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeedCreateModal;

