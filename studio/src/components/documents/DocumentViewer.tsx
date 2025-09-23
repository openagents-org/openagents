import React from 'react';
// TODO: Implement with HTTP event system
import OpenAgentsDocumentEditor from './OpenAgentsDocumentEditor';

interface DocumentViewerProps {
  documentId: string;
  connection: any; // TODO: HTTP event connector
  currentTheme: 'light' | 'dark';
  onBack: () => void;
  readOnly?: boolean;
}

const DocumentViewer: React.FC<DocumentViewerProps> = ({
  documentId,
  connection,
  currentTheme,
  onBack,
  readOnly = false
}) => {
  // Use the new pure OpenAgents-based collaborative DocumentEditor
  return (
    <OpenAgentsDocumentEditor
      documentId={documentId}
      connection={connection}
      currentTheme={currentTheme}
      onBack={onBack}
      readOnly={readOnly}
    />
  );
};

export default DocumentViewer;