import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImportMode, ImportValidationResult } from "@/types/networkManagement";

interface ImportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mode: ImportMode, newName?: string) => void;
  validationResult: ImportValidationResult | null;
  isImporting?: boolean;
}

const ImportPreviewModal: React.FC<ImportPreviewModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  validationResult,
  isImporting = false,
}) => {
  const { t } = useTranslation('network');
  const [mode, setMode] = useState<ImportMode>(ImportMode.OVERWRITE);
  const [newName, setNewName] = useState("");

  if (!isOpen || !validationResult || !validationResult.preview) return null;

  const preview = validationResult.preview;

  const handleConfirm = () => {
    if (mode === ImportMode.CREATE_NEW && !newName.trim()) {
      return;
    }
    onConfirm(mode, mode === ImportMode.CREATE_NEW ? newName.trim() : undefined);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full m-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              {t('importExport.preview.title')}
            </h3>
            <button
              onClick={onClose}
              disabled={isImporting}
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

          {/* Errors */}
          {validationResult.errors && validationResult.errors.length > 0 && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <div className="flex">
                <svg
                  className="w-5 h-5 text-red-400 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-red-800 dark:text-red-200">
                    {t('importExport.preview.validationError')}
                  </h4>
                  <ul className="mt-1 text-sm text-red-700 dark:text-red-300 list-disc list-inside">
                    {validationResult.errors.map((error, idx) => (
                      <li key={idx}>{error}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Warnings */}
          {validationResult.warnings && validationResult.warnings.length > 0 && (
            <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
              <div className="flex">
                <svg
                  className="w-5 h-5 text-yellow-400 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                    {t('importExport.preview.warnings')}
                  </h4>
                  <ul className="mt-1 text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside">
                    {validationResult.warnings.map((warning, idx) => (
                      <li key={idx}>{warning}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Preview Info */}
          <div className="mb-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('importExport.preview.networkName')}
              </label>
              <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {preview.network_name}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('importExport.preview.networkMode')}
              </label>
              <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {preview.network_mode}
              </p>
            </div>

            {preview.mods && preview.mods.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('importExport.preview.modules', { count: preview.mods.length })}
                </label>
                <ul className="mt-1 text-sm text-gray-900 dark:text-gray-100 list-disc list-inside">
                  {preview.mods.map((mod, idx) => (
                    <li key={idx}>{mod}</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.agent_groups && preview.agent_groups.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('importExport.preview.agentGroups', { count: preview.agent_groups.length })}
                </label>
                <ul className="mt-1 text-sm text-gray-900 dark:text-gray-100 list-disc list-inside">
                  {preview.agent_groups.map((group, idx) => (
                    <li key={idx}>{group}</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.transports && preview.transports.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('importExport.preview.transports', { count: preview.transports.length })}
                </label>
                <ul className="mt-1 text-sm text-gray-900 dark:text-gray-100 list-disc list-inside">
                  {preview.transports.map((transport, idx) => (
                    <li key={idx}>{transport}</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.export_timestamp && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('importExport.preview.exportTime')}
                </label>
                <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                  {new Date(preview.export_timestamp).toLocaleString()}
                </p>
              </div>
            )}

            {preview.export_notes && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('importExport.preview.exportNotes')}
                </label>
                <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                  {preview.export_notes}
                </p>
              </div>
            )}
          </div>

          {/* Import Mode Selection */}
          <div className="mb-4 border-t border-gray-200 dark:border-gray-700 pt-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('importExport.preview.importMode')}
            </label>
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="radio"
                  value={ImportMode.OVERWRITE}
                  checked={mode === ImportMode.OVERWRITE}
                  onChange={(e) => setMode(e.target.value as ImportMode)}
                  disabled={isImporting}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  {t('importExport.preview.overwrite')}
                </span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value={ImportMode.CREATE_NEW}
                  checked={mode === ImportMode.CREATE_NEW}
                  onChange={(e) => setMode(e.target.value as ImportMode)}
                  disabled={isImporting}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  {t('importExport.preview.createNew')}
                </span>
              </label>
            </div>

            {mode === ImportMode.CREATE_NEW && (
              <div className="mt-3">
                <label
                  htmlFor="new-network-name"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  {t('importExport.preview.newNetworkName')}
                </label>
                <input
                  id="new-network-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={isImporting}
                  placeholder={t('importExport.preview.newNetworkNamePlaceholder')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {t('importExport.preview.cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={
                isImporting ||
                !validationResult.valid ||
                (mode === ImportMode.CREATE_NEW && !newName.trim())
              }
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {isImporting ? t('importExport.preview.importing') : t('importExport.preview.confirmImport')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImportPreviewModal;

