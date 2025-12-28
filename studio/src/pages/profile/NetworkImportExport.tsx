import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { networkManagementService } from "@/services/networkManagementService";
import { ImportMode } from "@/types/networkManagement";
import ImportDropzone from "@/components/network/ImportDropzone";
import ImportPreviewModal from "@/components/network/ImportPreviewModal";
import ExportOptionsModal from "@/components/network/ExportOptionsModal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { profileSelectors } from "@/stores/profileStore";
import { useAuthStore } from "@/stores/authStore";
import { useOpenAgents } from "@/context/OpenAgentsProvider";

const NetworkImportExport: React.FC = () => {
  const { t } = useTranslation('network');
  const networkInfo = profileSelectors.useNetworkInfo();
  const { selectedNetwork, agentName } = useAuthStore();
  const { connector } = useOpenAgents();
  const networkName = networkInfo?.networkName || "Network";

  // Export state
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Import state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [pendingImportMode, setPendingImportMode] = useState<ImportMode | null>(null);
  const [pendingNewName, setPendingNewName] = useState<string | undefined>(undefined);

  // Handle export
  const handleExportClick = () => {
    setShowExportOptions(true);
  };

  const handleExportConfirm = async (options: any) => {
    setIsExporting(true);
    setShowExportOptions(false);

    try {
      // Get secret and agentId for authentication
      const secret = connector?.getSecret() || null;
      const agentId = agentName || null;

      if (!secret || !agentId) {
        throw new Error(t('importExport.export.loginRequired'));
      }

      const blob = await networkManagementService.exportNetwork(
        options,
        agentId,
        secret
      );
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${networkName}_${timestamp}.zip`;
      networkManagementService.downloadBlob(blob, filename);
    } catch (error: any) {
      alert(t('importExport.export.failed', { error: error.message }));
    } finally {
      setIsExporting(false);
    }
  };

  // Handle import file selection
  const handleFileSelected = async (file: File) => {
    setSelectedFile(file);
    setIsImporting(true);

    try {
      // Get secret and agentId for authentication
      const secret = connector?.getSecret() || null;
      const agentId = agentName || null;

      if (!secret || !agentId) {
        throw new Error(t('importExport.import.loginRequired'));
      }

      const result = await networkManagementService.validateImport(
        file,
        agentId,
        secret
      );
      setValidationResult(result);
      if (result.valid) {
        setShowPreview(true);
      } else {
        alert(`${t('importExport.import.validationFailed')}:\n${result.errors.join("\n")}`);
      }
    } catch (error: any) {
      alert(`${t('importExport.import.validationFailed')}: ${error.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  // Handle import confirm
  const handleImportConfirm = (mode: ImportMode, newName?: string) => {
    if (mode === ImportMode.OVERWRITE) {
      setPendingImportMode(mode);
      setPendingNewName(newName);
      setShowOverwriteConfirm(true);
    } else {
      performImport(mode, newName);
    }
  };

  const performImport = async (mode: ImportMode, newName?: string) => {
    if (!selectedFile) return;

    setShowPreview(false);
    setShowOverwriteConfirm(false);
    setIsImporting(true);

    try {
      // Get secret and agentId for authentication
      const secret = connector?.getSecret() || null;
      const agentId = agentName || null;

      if (!secret || !agentId) {
        throw new Error(t('importExport.import.loginRequiredImport'));
      }

      const result = await networkManagementService.applyImport(
        selectedFile,
        mode,
        newName,
        agentId,
        secret
      );

      if (result.success) {
        const appliedNetworkName = result.applied_config?.network_name || networkName;
        if (result.network_restarted) {
          alert(t('importExport.import.importSuccess', { name: appliedNetworkName }));
          // Refresh profile data after successful import
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } else {
          // 如果是异步执行，network_restarted 会是 false，但导入已启动
          const errorMsg = result.errors && result.errors.length > 0 
            ? result.errors.join("\n")
            : t('importExport.import.networkRestartUnknown');
          alert(
            t('importExport.import.importStarted', { name: appliedNetworkName, status: errorMsg })
          );
        }
      } else {
        const errorMsg = result.errors && result.errors.length > 0
          ? result.errors.join("\n")
          : result.message;
        alert(t('importExport.import.importFailed', { error: errorMsg }));
      }
    } catch (error: any) {
      alert(t('importExport.import.importFailed', { error: error.message }));
    } finally {
      setIsImporting(false);
      setSelectedFile(null);
      setValidationResult(null);
      setPendingImportMode(null);
      setPendingNewName(undefined);
    }
  };

  const handleOverwriteConfirm = () => {
    if (pendingImportMode) {
      performImport(pendingImportMode, pendingNewName);
    }
  };

  if (!selectedNetwork) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            {t('importExport.connectFirst')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 dark:bg-gray-900 h-full overflow-y-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('importExport.title')}
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          {t('importExport.subtitle')}
        </p>
      </div>

      <div className="max-w-4xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Export Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 flex flex-col">
            <div className="flex items-center mb-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mr-3">
                <svg
                  className="w-5 h-5 text-blue-600 dark:text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('importExport.export.title')}
              </h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 flex-1">
              {t('importExport.export.description')}
            </p>
            <button
              onClick={handleExportClick}
              disabled={isExporting}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isExporting ? t('importExport.export.exporting') : t('importExport.export.button')}
            </button>
          </div>

          {/* Import Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 flex flex-col">
            <div className="flex items-center mb-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center mr-3">
                <svg
                  className="w-5 h-5 text-green-600 dark:text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('importExport.import.title')}
              </h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {t('importExport.import.description')}
            </p>
            <ImportDropzone
              onFileSelected={handleFileSelected}
              disabled={isImporting}
            />
          </div>
        </div>
      </div>

      {/* Modals */}
      <ExportOptionsModal
        isOpen={showExportOptions}
        onClose={() => setShowExportOptions(false)}
        onConfirm={handleExportConfirm}
        isExporting={isExporting}
      />

      <ImportPreviewModal
        isOpen={showPreview}
        onClose={() => {
          setShowPreview(false);
          setSelectedFile(null);
          setValidationResult(null);
        }}
        onConfirm={handleImportConfirm}
        validationResult={validationResult}
        isImporting={isImporting}
      />

      <ConfirmDialog
        isOpen={showOverwriteConfirm}
        title={t('importExport.overwriteConfirm.title')}
        message={t('importExport.overwriteConfirm.message')}
        confirmText={t('importExport.overwriteConfirm.confirm')}
        cancelText={t('importExport.overwriteConfirm.cancel')}
        onConfirm={handleOverwriteConfirm}
        onCancel={() => {
          setShowOverwriteConfirm(false);
          setPendingImportMode(null);
          setPendingNewName(undefined);
        }}
        type="warning"
      />
    </div>
  );
};

export default NetworkImportExport;

