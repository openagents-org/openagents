import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExportOptions } from "@/types/networkManagement";

interface ExportOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: ExportOptions) => void;
  isExporting?: boolean;
}

const ExportOptionsModal: React.FC<ExportOptionsModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isExporting = false,
}) => {
  const { t } = useTranslation('network');
  const [includePasswordHashes, setIncludePasswordHashes] = useState(false);
  const [includeSensitiveConfig, setIncludeSensitiveConfig] = useState(false);
  const [notes, setNotes] = useState("");

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm({
      include_password_hashes: includePasswordHashes,
      include_sensitive_config: includeSensitiveConfig,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full m-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              {t('importExport.exportOptions.title')}
            </h3>
            <button
              onClick={onClose}
              disabled={isExporting}
              className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
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

          {/* Options */}
          <div className="space-y-4">
            {/* Include Password Hashes */}
            <div className="flex items-start">
              <div className="flex items-center h-5">
                <input
                  id="include-password-hashes"
                  type="checkbox"
                  checked={includePasswordHashes}
                  onChange={(e) => setIncludePasswordHashes(e.target.checked)}
                  disabled={isExporting}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
              </div>
              <div className="ml-3 text-sm">
                <label
                  htmlFor="include-password-hashes"
                  className="font-medium text-gray-700 dark:text-gray-300"
                >
                  {t('importExport.exportOptions.includePasswordHashes')}
                </label>
                <p className="text-gray-500 dark:text-gray-400">
                  {t('importExport.exportOptions.includePasswordHashesDesc')}
                </p>
              </div>
            </div>

            {/* Include Sensitive Config */}
            <div className="flex items-start">
              <div className="flex items-center h-5">
                <input
                  id="include-sensitive-config"
                  type="checkbox"
                  checked={includeSensitiveConfig}
                  onChange={(e) =>
                    setIncludeSensitiveConfig(e.target.checked)
                  }
                  disabled={isExporting}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
              </div>
              <div className="ml-3 text-sm">
                <label
                  htmlFor="include-sensitive-config"
                  className="font-medium text-gray-700 dark:text-gray-300"
                >
                  {t('importExport.exportOptions.includeSensitiveConfig')}
                </label>
                <p className="text-gray-500 dark:text-gray-400">
                  {t('importExport.exportOptions.includeSensitiveConfigDesc')}
                </p>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label
                htmlFor="export-notes"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                {t('importExport.exportOptions.notes')}
              </label>
              <textarea
                id="export-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isExporting}
                placeholder={t('importExport.exportOptions.notesPlaceholder')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {t('importExport.exportOptions.cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isExporting}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {isExporting ? t('importExport.exportOptions.exporting') : t('importExport.exportOptions.export')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExportOptionsModal;

