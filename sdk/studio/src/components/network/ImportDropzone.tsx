import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

interface ImportDropzoneProps {
  onFileSelected: (file: File) => void;
  accept?: string;
  disabled?: boolean;
}

const ImportDropzone: React.FC<ImportDropzoneProps> = ({
  onFileSelected,
  accept = ".zip",
  disabled = false,
}) => {
  const { t } = useTranslation('network');
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const files = Array.from(e.dataTransfer.files);
      const zipFile = files.find((f) => f.name.endsWith(".zip"));

      if (!zipFile) {
        setError(t('importExport.dropzone.selectZipFile'));
        return;
      }

      setError(null);
      onFileSelected(zipFile);
    },
    [onFileSelected, disabled, t]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      if (!file.name.endsWith(".zip")) {
        setError(t('importExport.dropzone.selectZipFile'));
        return;
      }

      setError(null);
      onFileSelected(file);
    },
    [onFileSelected, t]
  );

  return (
    <div className="w-full">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-lg p-6 text-center transition-colors
          ${
            isDragging
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
              : "border-gray-300 dark:border-gray-600"
          }
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-gray-400 dark:hover:border-gray-500"}
        `}
      >
        <input
          type="file"
          accept={accept}
          onChange={handleFileInput}
          disabled={disabled}
          className="hidden"
          id="file-upload"
        />
        <label
          htmlFor="file-upload"
          className={`cursor-pointer ${disabled ? "cursor-not-allowed" : ""}`}
        >
          <div className="flex flex-col items-center">
            <svg
              className="w-10 h-10 text-gray-400 dark:text-gray-500 mb-3"
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
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('importExport.dropzone.dragDrop')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('importExport.dropzone.supportedFormat')}
            </p>
          </div>
        </label>
      </div>
      {error && (
        <div className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
    </div>
  );
};

export default ImportDropzone;

