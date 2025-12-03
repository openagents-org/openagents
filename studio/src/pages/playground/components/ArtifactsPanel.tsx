import React, { useState } from "react";
import { usePlaygroundStore } from "@/stores/playgroundStore";

interface ArtifactEditorProps {
  artifactKey: string;
  value: string;
  onSave: (key: string, value: string) => Promise<void>;
  onClose: () => void;
}

const ArtifactEditor: React.FC<ArtifactEditorProps> = ({
  artifactKey,
  value,
  onSave,
  onClose,
}) => {
  const [content, setContent] = useState(value);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(artifactKey, content);
    setIsSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Edit: {artifactKey}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 p-4 overflow-hidden">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-full min-h-[300px] px-3 py-2 border border-gray-300 dark:border-gray-600
              rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
              focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-sm"
            placeholder="Enter content..."
          />
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100
              dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700
              disabled:opacity-50 transition-colors"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ArtifactsPanel: React.FC = () => {
  const { currentSession, setArtifact, deleteArtifact } = usePlaygroundStore();
  const [editingArtifact, setEditingArtifact] = useState<{ key: string; value: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newKey, setNewKey] = useState("");

  if (!currentSession) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
        <p>No session selected</p>
      </div>
    );
  }

  const artifacts = Object.entries(currentSession.artifacts || {});

  const handleCreate = async () => {
    if (!newKey.trim()) return;
    await setArtifact(newKey.trim(), "");
    setNewKey("");
    setIsCreating(false);
    setEditingArtifact({ key: newKey.trim(), value: "" });
  };

  const handleSave = async (key: string, value: string) => {
    await setArtifact(key, value);
  };

  const handleDelete = async (key: string) => {
    if (confirm(`Delete artifact "${key}"?`)) {
      await deleteArtifact(key);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Artifacts
          </h2>
          <button
            onClick={() => setIsCreating(true)}
            className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
            title="New Artifact"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Create New */}
      {isCreating && (
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex gap-2">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="Artifact name..."
              className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setIsCreating(false);
              }}
            />
            <button
              onClick={handleCreate}
              disabled={!newKey.trim()}
              className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => setIsCreating(false)}
              className="px-3 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100
                dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Artifacts List */}
      <div className="flex-1 overflow-y-auto">
        {artifacts.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <svg
              className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="text-sm">No artifacts yet</p>
            <p className="text-xs mt-1">Create an artifact to store shared outputs</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {artifacts.map(([key, value]) => (
              <div
                key={key}
                className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-gray-900 dark:text-white truncate">
                      {key}
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                      {typeof value === 'string' ? value.substring(0, 100) : String(value)}
                      {typeof value === 'string' && value.length > 100 && "..."}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => setEditingArtifact({ key, value: String(value) })}
                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50
                        dark:hover:bg-blue-900/20 rounded transition-colors"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(key)}
                      className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50
                        dark:hover:bg-red-900/20 rounded transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {editingArtifact && (
        <ArtifactEditor
          artifactKey={editingArtifact.key}
          value={editingArtifact.value}
          onSave={handleSave}
          onClose={() => setEditingArtifact(null)}
        />
      )}
    </div>
  );
};

export default ArtifactsPanel;
