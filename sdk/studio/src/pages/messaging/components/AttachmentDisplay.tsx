import React from 'react';

interface AttachmentDisplayProps {
  attachments?: Array<{
    fileId: string;
    filename: string;
    size: number;
    fileType?: string;
  }>;
  // Network connection details for download
  networkHost?: string;
  networkPort?: number;
  agentId?: string;
  agentSecret?: string | null;
}

const AttachmentDisplay: React.FC<AttachmentDisplayProps> = ({
  attachments,
  networkHost,
  networkPort,
  agentId: propsAgentId,
  agentSecret,
}) => {
  // Handle download for a single attachment
  const handleDownload = (fileId: string, filename: string) => {
    const agentId = propsAgentId || 'anonymous';

    // Build download URL using actual network connection details
    const host = networkHost || window.location.hostname;
    const port = networkPort || 8700;

    // Build query params
    const params = new URLSearchParams();
    params.append('agent_id', agentId);
    if (agentSecret) {
      params.append('secret', agentSecret);
    }

    const downloadUrl = `http://${host}:${port}/api/cache/download/${fileId}?${params.toString()}`;

    // Create a temporary anchor element to trigger download
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Format file size for display
  const formatFileSize = (size: number): string => {
    if (!size) return 'Unknown size';

    if (size < 1024) return `${size} bytes`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  // Get file icon based on filename extension
  const getFileIcon = (filename: string): React.ReactNode => {
    const extension = filename.split('.').pop()?.toLowerCase();

    switch (extension) {
      case 'txt':
      case 'md':
      case 'rtf':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
      case 'pdf':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        );
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
      case 'svg':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        );
      case 'zip':
      case 'rar':
      case '7z':
      case 'tar':
      case 'gz':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        );
      default:
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.586-6.586a2 2 0 00-2.828-2.828z" />
          </svg>
        );
    }
  };

  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {attachments.length > 1 && (
        <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          {attachments.length} files attached:
        </div>
      )}
      {attachments.map(attachment => (
        <div
          key={attachment.fileId}
          className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
        >
          <div className="flex items-center space-x-3 flex-1 min-w-0">
            <div className="flex-shrink-0 text-gray-500 dark:text-gray-400">
              {getFileIcon(attachment.filename)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {attachment.filename}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {formatFileSize(attachment.size)}
              </p>
            </div>
          </div>
          <button
            onClick={() => handleDownload(attachment.fileId, attachment.filename)}
            className="flex-shrink-0 inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:hover:bg-blue-800 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download
          </button>
        </div>
      ))}
    </div>
  );
};

export default AttachmentDisplay;
